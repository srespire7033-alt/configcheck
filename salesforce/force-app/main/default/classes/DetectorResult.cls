/**
 * One row of detector output — a single leak finding.
 *
 * Apex equivalent of the TypeScript DetectorResult interface in
 * the SaaS codebase. Field names match the ForensicFinding__c
 * Custom Object so the orchestrator can mechanically copy from
 * this DTO to the persisted record.
 *
 * Severity values: 'Critical', 'Warning', 'Info' (matches the
 * Severity__c picklist).
 */
public class DetectorResult {
    public String detectorId;
    public String severity;            // 'Critical' | 'Warning' | 'Info'

    public Decimal entitledUsd;        // what the contract entitled
    public Decimal realizedUsd;        // what was actually billed/quoted
    public Decimal gapUsd;             // entitled - realized
    public String currencyIsoCode;     // default to org currency

    public Decimal recoverabilityScore; // 0.0-1.0

    /** The primary leaking record. */
    public SourceRecord primaryRecord;
    /** Supporting records that contextualize the finding. */
    public List<SourceRecord> supportingRecords;

    public String title;
    public String description;

    /** Detector-specific fields for the attribution tracer (serialized to JSON in Metadata__c). */
    public Map<String, Object> metadata;

    public DetectorResult() {
        this.supportingRecords = new List<SourceRecord>();
        this.metadata = new Map<String, Object>();
        this.recoverabilityScore = 1.0;
    }

    /** Compute gapUsd from entitled - realized. Call after setting both. */
    public void computeGap() {
        Decimal e = (entitledUsd != null) ? entitledUsd : 0;
        Decimal r = (realizedUsd != null) ? realizedUsd : 0;
        this.gapUsd = e - r;
    }

    /**
     * Phase 24c — per-record emission helper. Collapses the
     * "1 finding per record" pattern that 80+ evaluators did inline.
     * Severity comes from the catalog; sevFallback used when null.
     * titleTemplate uses {name} as a placeholder for SourceRecord.name.
     */
    public static List<DetectorResult> emitPerRecord(
        List<SourceRecord> records,
        String detectorId,
        String sevFallback,
        Decimal gapUsdEach,
        Decimal recoverability,
        String titleTemplate,
        String description
    ) {
        List<DetectorResult> out = new List<DetectorResult>();
        if (records == null || records.isEmpty()) return out;
        String sev = DetectorCatalogController.getSeverity(detectorId, sevFallback);
        for (SourceRecord sr : records) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = detectorId;
            dr.severity = sev;
            dr.gapUsd = gapUsdEach;
            dr.recoverabilityScore = recoverability;
            String safeName = (sr != null && sr.name != null) ? sr.name : 'record';
            dr.title = titleTemplate.replace('{name}', safeName);
            dr.description = description;
            dr.primaryRecord = sr;
            out.add(dr);
        }
        return out;
    }
}
