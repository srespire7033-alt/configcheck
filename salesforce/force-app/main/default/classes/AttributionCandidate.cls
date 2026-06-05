/**
 * In-memory DTO emitted by an IAttributionTracer. Mirrors the columns
 * of AttributionTrace__c — the AttributionService is responsible for
 * turning a List<AttributionCandidate> into persisted records and
 * linking them to the ForensicFinding__c that produced them.
 *
 * Confidence is a 0.0–1.0 score; when multiple tracers fire on the
 * same finding, AttributionService inserts all candidates but the
 * highest-confidence one is the "primary" story (the rest surface
 * in the UI as "also suspected").
 */
public class AttributionCandidate {
    public String rootCauseClass;       // 'A' | 'B' | 'C' | 'D' | 'E'
    public String rootConfigType;       // sObject API name or 'Flow'
    public String rootConfigId;         // Id of the upstream config (may be null)
    public String rootConfigName;       // human-readable label
    public String reasonCode;           // stable enum (e.g. 'MANUAL_OVERRIDE_BELOW_LIST')
    public Decimal confidence;          // 0.0 – 1.0
    public Map<String, Object> evidence;// serialized to Evidence__c JSON

    public AttributionCandidate() {
        this.evidence = new Map<String, Object>();
    }
}
