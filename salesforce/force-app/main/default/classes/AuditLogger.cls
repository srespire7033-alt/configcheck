/**
 * Phase 24z-I — Single ingress for scan-time audit events.
 *
 * Goals:
 *   1. Survive past the 24h debug-log retention window. Failures, gating
 *      decisions, and silent swallows persist on ScanAuditEvent__c records
 *      tied to the originating ForensicScan__c.
 *   2. Single ingress so we can later (24z-K) hook Platform Event firing,
 *      sampling, redaction, etc. without touching every call site.
 *   3. Survive partial scan failures. The logger NEVER throws — a logging
 *      failure cannot tank a scan. Best-effort with try/catch swallow +
 *      System.debug fallback so the event still shows up somewhere.
 *
 * Usage:
 *   AuditLogger.info(scanId, AuditLogger.SRC_PROBE, null,
 *       'Probe returned ' + n + ' SObjects');
 *   AuditLogger.warn(scanId, AuditLogger.SRC_GATING, 'ARM-001',
 *       'Skipped — ProductSellingModelOption absent on target');
 *   AuditLogger.error(scanId, AuditLogger.SRC_DETECTOR, 'REN-001',
 *       'Detector run failed', e);
 *
 * Performance:
 *   Events are buffered per-tx and inserted in a single DML at flush()
 *   time. The Queueable / @future / scheduled context auto-flushes via
 *   System.attachFinalizer when supported; explicit flush() is also safe.
 *   Callers in tight loops (per-record detectors, etc.) should NOT log
 *   per-row — emit a single Info event with counts.
 */
public with sharing class AuditLogger {

    // ── Source constants (match Source__c picklist) ─────────────────────
    public static final String SRC_DETECTOR    = 'detector';
    public static final String SRC_CHUNK       = 'chunk';
    public static final String SRC_PROBE       = 'probe';
    public static final String SRC_GATING      = 'gating';
    public static final String SRC_FINALIZE    = 'finalize';
    public static final String SRC_ATTRIBUTION = 'attribution';
    public static final String SRC_TRUST       = 'trust';
    public static final String SRC_HEALTH      = 'health';
    public static final String SRC_AUTODETECT  = 'auto-detect';
    public static final String SRC_OTHER       = 'other';

    // ── Severity constants (match Severity__c picklist) ─────────────────
    public static final String SEV_INFO  = 'Info';
    public static final String SEV_WARN  = 'Warn';
    public static final String SEV_ERROR = 'Error';

    private static final Integer MSG_MAX = 32768;
    private static final Integer STACK_MAX = 32768;

    /** Per-tx buffer. Flushed on flush() or autoflush via finalizer. */
    @TestVisible private static List<ScanAuditEvent__c> buffer = new List<ScanAuditEvent__c>();

    // ── Public API ──────────────────────────────────────────────────────

    public static void info(Id scanId, String source, String detectorId, String message) {
        enqueue(scanId, SEV_INFO, source, detectorId, message, null);
    }

    public static void warn(Id scanId, String source, String detectorId, String message) {
        enqueue(scanId, SEV_WARN, source, detectorId, message, null);
    }

    public static void error(Id scanId, String source, String detectorId, String message) {
        enqueue(scanId, SEV_ERROR, source, detectorId, message, null);
    }

    /**
     * Error overload — pass the Exception to capture stack trace.
     * Stack trace lives on StackTrace__c; the Message__c only carries
     * the exception type + getMessage() so the row stays readable.
     */
    public static void error(Id scanId, String source, String detectorId,
                              String message, Exception ex) {
        String msg = message;
        String stack = null;
        if (ex != null) {
            msg += ' [' + ex.getTypeName() + ': ' + ex.getMessage() + ']';
            stack = ex.getStackTraceString();
        }
        enqueue(scanId, SEV_ERROR, source, detectorId, msg, stack);
    }

    /**
     * Force an immediate flush. Callers should call this at the end of a
     * Queueable execute() so events survive even if the finalizer doesn't
     * attach (some old API versions). Idempotent — safe to call twice.
     */
    public static void flush() {
        if (buffer.isEmpty()) return;
        // Snapshot + clear before insert so any inner exception during DML
        // doesn't leave us in a half-flushed state.
        List<ScanAuditEvent__c> toInsert = buffer;
        buffer = new List<ScanAuditEvent__c>();
        try {
            insert toInsert;
        } catch (Exception e) {
            // Logging the logger's failure is a paradox; fall back to
            // System.debug so at least it shows up in a trace log.
            System.debug(LoggingLevel.ERROR,
                '[AuditLogger] insert failed: ' + e.getMessage() +
                ' (lost ' + toInsert.size() + ' events)');
        }
    }

    // ── Internals ───────────────────────────────────────────────────────

    private static void enqueue(Id scanId, String severity, String source,
                                 String detectorId, String message, String stack) {
        try {
            // Mandatory-field guard. Without these, the insert blows up at
            // flush time and we'd lose the whole buffer.
            if (scanId == null || String.isBlank(source) || String.isBlank(severity)) {
                System.debug(LoggingLevel.WARN,
                    '[AuditLogger] dropped event — missing required field. '
                    + 'scanId=' + scanId + ' source=' + source + ' sev=' + severity);
                return;
            }
            ScanAuditEvent__c ev = new ScanAuditEvent__c(
                ForensicScan__c = scanId,
                Severity__c = severity,
                Source__c = source,
                DetectorId__c = String.isBlank(detectorId) ? null
                    : detectorId.left(50),
                Message__c = String.isBlank(message) ? '(no message)'
                    : message.left(MSG_MAX),
                StackTrace__c = String.isBlank(stack) ? null : stack.left(STACK_MAX)
            );
            buffer.add(ev);

            // Mirror to debug log so live-trace sessions still surface it.
            // Debug logs are still the fastest way to diagnose during dev;
            // ScanAuditEvent__c is the durable record for prod.
            LoggingLevel ll = (severity == SEV_ERROR) ? LoggingLevel.ERROR
                : (severity == SEV_WARN) ? LoggingLevel.WARN
                : LoggingLevel.INFO;
            System.debug(ll, '[OrgPrism/' + source +
                (String.isBlank(detectorId) ? '' : '/' + detectorId) + '] ' + message);
        } catch (Exception e) {
            // Defense in depth. Logger MUST NOT throw.
            System.debug(LoggingLevel.ERROR,
                '[AuditLogger] enqueue threw: ' + e.getMessage());
        }
    }
}
