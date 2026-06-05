/**
 * Runs all registered IAttributionTracers across every finding from
 * a completed scan and persists their candidates as AttributionTrace__c
 * records. Called by ForensicScanService after findings are inserted.
 *
 * Tracers are run in a fixed order (A→E) but ordering is irrelevant
 * to output — every candidate is inserted regardless of which tracer
 * produced it. The Finding Detail UI reads them back ordered by
 * Confidence__c desc and treats the top one as "primary cause."
 *
 * Failure model: a single tracer throwing on a single finding is
 * caught + logged; the rest of the pipeline keeps running. A failed
 * trace produces no AttributionTrace__c — the finding simply has no
 * attribution surface, same as before the tracer existed.
 */
public with sharing class AttributionService {

    /** Registry of tracers. Order is informational only. */
    @TestVisible
    private static List<IAttributionTracer> getTracers() {
        return new List<IAttributionTracer>{
            new ClassATracer(),
            new ClassBTracer(),
            new ClassCTracer(),
            new ClassDTracer(),
            new ClassETracer()
        };
    }

    /**
     * Trace every finding belonging to a scan. Bulk-inserts the
     * resulting AttributionTrace__c records. Returns the number of
     * traces persisted (useful for tests + diagnostics).
     */
    public static Integer traceScan(Id scanId, DetectorContext ctx) {
        if (scanId == null) return 0;

        List<ForensicFinding__c> findings = [
            SELECT Id, DetectorId__c, Title__c, PrimaryRecordType__c,
                   PrimaryRecordId__c, Metadata__c
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId
            LIMIT 5000
        ];
        if (findings.isEmpty()) return 0;

        List<IAttributionTracer> tracers = getTracers();
        List<AttributionTrace__c> toInsert = new List<AttributionTrace__c>();

        for (ForensicFinding__c f : findings) {
            Map<String, Object> meta = parseMetadata(f.Metadata__c);
            for (IAttributionTracer tracer : tracers) {
                try {
                    List<AttributionCandidate> cands = tracer.trace(f, meta, ctx);
                    if (cands == null) continue;
                    for (AttributionCandidate c : cands) {
                        if (c == null) continue;
                        toInsert.add(toRecord(f.Id, c));
                    }
                } catch (Exception e) {
                    System.debug(LoggingLevel.WARN,
                        'Tracer ' + tracer.getRootCauseClass()
                        + ' failed on finding ' + f.Id + ': ' + e.getMessage());
                }
            }
        }

        if (toInsert.isEmpty()) return 0;
        // Allow partial inserts — a single bad row shouldn't kill the
        // whole batch (e.g. an Evidence__c that exceeds 32k after some
        // bizarre detector emits a huge blob).
        Database.insert(toInsert, false);
        return toInsert.size();
    }

    @TestVisible
    private static Map<String, Object> parseMetadata(String raw) {
        if (String.isBlank(raw)) return new Map<String, Object>();
        try {
            Object parsed = JSON.deserializeUntyped(raw);
            if (parsed instanceof Map<String, Object>) {
                return (Map<String, Object>) parsed;
            }
            return new Map<String, Object>();
        } catch (Exception e) {
            return new Map<String, Object>();
        }
    }

    @TestVisible
    private static AttributionTrace__c toRecord(Id findingId, AttributionCandidate c) {
        AttributionTrace__c t = new AttributionTrace__c(
            ForensicFinding__c = findingId,
            RootCauseClass__c  = c.rootCauseClass,
            RootConfigType__c  = c.rootConfigType,
            RootConfigId__c    = c.rootConfigId,
            RootConfigName__c  = truncate(c.rootConfigName, 255),
            ReasonCode__c      = c.reasonCode,
            Confidence__c      = c.confidence
        );
        String ev = c.evidence == null ? '{}' : JSON.serialize(c.evidence);
        if (ev.length() > 32768) ev = ev.substring(0, 32768);
        t.Evidence__c = ev;

        // Phase 12 — render a polished sentence into AiExplanation__c so
        // the Finding Detail UI / executive PDF have a ready-to-read
        // attribution narrative. We use template-driven prose; the
        // AiModel__c tag tells consumers the source.
        try {
            String prose = AttributionRenderer.render(c.reasonCode, c.evidence);
            if (String.isNotBlank(prose)) {
                if (prose.length() > 32768) prose = prose.substring(0, 32768);
                t.AiExplanation__c = prose;
                t.AiModel__c = AttributionRenderer.MODEL_TAG;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'AttributionRenderer.render failed: ' + e.getMessage());
        }
        return t;
    }

    private static String truncate(String s, Integer max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
