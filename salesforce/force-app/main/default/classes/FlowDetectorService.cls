/**
 * Phase 19c — Tier 3: Flow-driven detectors.
 *
 * For each active FlowDetector__mdt record:
 *   1. Look up the registered Flow by API name
 *   2. Invoke it with input { productType }
 *   3. Read the Findings output collection (List<ForensicFinding__c>)
 *   4. Convert each Finding to a DetectorResult so the rest of the
 *      pipeline (suppression, attribution, recovery queue, recipes)
 *      treats it identically to coded + SOQL-defined detectors.
 *
 * Flow Detector Contract (admin-facing):
 *   - Flow type: Autolaunched (no triggers, no screens)
 *   - Input variable: productType (Text)
 *   - Output variable: Findings (collection, ForensicFinding__c)
 *   - Findings must be UNINSERTED — OrgPrism inserts them through
 *     the standard pipeline so suppression + scan-id + currency get
 *     applied uniformly.
 *
 * Limitations (documented; not bugs):
 *   - Skipped on remote-org scans. Flows execute in the host org's
 *     data context; they cannot route queries through Named Credentials.
 *     If a customer needs remote-org detection, they write a Tier 2
 *     CustomDetector__mdt with SOQL (OrgQueryService routes that
 *     correctly) or an Apex IDetector class.
 *   - Each Flow runs in its own try/catch. A failed Flow logs to
 *     scan.ErrorMessage__c and the scan continues.
 */
public with sharing class FlowDetectorService {

    /** Public entry point — returns merged DetectorResult list. */
    public static List<DetectorResult> runAll(DetectorContext ctx) {
        List<DetectorResult> out = new List<DetectorResult>();
        if (ctx == null) return out;

        // Phase 19c — remote scans skip Flow detectors. Flows run in
        // the host org's context, so they can't see the target org.
        if (ctx.isRemote()) {
            System.debug(LoggingLevel.INFO,
                'FlowDetectorService skipped — remote-org scan does not support Flow detectors.');
            return out;
        }

        List<FlowDetector__mdt> defs;
        try {
            defs = [
                SELECT DeveloperName, DetectorId__c, Label__c, FlowApiName__c,
                       AppliesTo__c, Description__c, IsActive__c, Version__c
                FROM FlowDetector__mdt
                WHERE IsActive__c = true
            ];
        } catch (Exception e) {
            System.debug(LoggingLevel.INFO,
                'FlowDetector__mdt unavailable: ' + e.getMessage());
            return out;
        }

        for (FlowDetector__mdt def : defs) {
            if (!matchesProductType(def, ctx.productType)) continue;
            if (String.isBlank(def.FlowApiName__c)) continue;
            try {
                out.addAll(runOne(def, ctx));
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN,
                    'FlowDetector ' + def.DetectorId__c + ' (' + def.FlowApiName__c +
                    ') failed: ' + e.getMessage());
            }
        }
        return out;
    }

    /**
     * Invoke one Flow, harvest its Findings output, convert each to a
     * DetectorResult. Package-private + @TestVisible so the test class
     * can exercise the happy path directly.
     */
    @TestVisible
    private static List<DetectorResult> runOne(FlowDetector__mdt def, DetectorContext ctx) {
        List<DetectorResult> out = new List<DetectorResult>();
        Map<String, Object> inputs = new Map<String, Object>{
            'productType' => ctx.productType
        };

        Flow.Interview iv;
        try {
            iv = Flow.Interview.createInterview(def.FlowApiName__c, inputs);
        } catch (Exception e) {
            throw new FlowDetectorException(
                'Could not create Flow interview for ' + def.FlowApiName__c + ': ' + e.getMessage());
        }

        try {
            iv.start();
        } catch (Exception e) {
            throw new FlowDetectorException(
                'Flow ' + def.FlowApiName__c + ' threw during start(): ' + e.getMessage());
        }

        Object raw = iv.getVariableValue('Findings');
        if (raw == null) return out;
        if (!(raw instanceof List<Object>)) {
            throw new FlowDetectorException(
                'Flow ' + def.FlowApiName__c +
                ' output variable "Findings" must be a collection of ForensicFinding__c.');
        }

        for (Object o : (List<Object>) raw) {
            if (!(o instanceof ForensicFinding__c)) continue;
            ForensicFinding__c f = (ForensicFinding__c) o;
            out.add(toDetectorResult(def, f));
        }
        return out;
    }

    /**
     * Marshal a Flow-built ForensicFinding__c into a DetectorResult so
     * it traverses the same pipeline as Apex + SOQL detectors.
     * The Flow author sets the fields directly on the ForensicFinding;
     * we use them as the source of truth, falling back to the mdt's
     * DetectorId when the Flow forgot to populate it.
     */
    @TestVisible
    private static DetectorResult toDetectorResult(FlowDetector__mdt def, ForensicFinding__c f) {
        DetectorResult r = new DetectorResult();
        r.detectorId = String.isNotBlank(f.DetectorId__c)
            ? f.DetectorId__c : def.DetectorId__c;
        r.title = f.Title__c;
        r.description = f.Description__c;
        r.entitledUsd = f.EntitledUsd__c;
        r.realizedUsd = f.RealizedUsd__c == null ? 0 : f.RealizedUsd__c;
        r.computeGap();
        // Severity & recoverability via the catalog so admins tune in
        // one place. Flow can also set Severity__c directly; we honor it.
        r.severity = String.isNotBlank(f.Severity__c)
            ? f.Severity__c
            : DetectorCatalogController.resolveSeverity(r.detectorId, r.gapUsd);
        r.recoverabilityScore = (f.RecoverabilityScore__c != null)
            ? f.RecoverabilityScore__c
            : DetectorCatalogController.getRecoverability(r.detectorId, 0.5);
        r.currencyIsoCode = CurrencyContext.read(f);
        if (String.isNotBlank(f.PrimaryRecordId__c)) {
            r.primaryRecord = new SourceRecord(
                f.PrimaryRecordType__c, f.PrimaryRecordId__c, f.Title__c);
        }
        return r;
    }

    @TestVisible
    private static Boolean matchesProductType(FlowDetector__mdt def, String productType) {
        if (String.isBlank(productType)) return true;
        if (String.isBlank(def.AppliesTo__c)) return true;
        for (String pt : def.AppliesTo__c.split(';')) {
            if (pt.trim() == productType) return true;
        }
        return false;
    }

    public class FlowDetectorException extends Exception {}
}
