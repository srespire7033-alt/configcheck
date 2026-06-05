/**
 * One of the 5 root-cause classes (A System Disconnect, B Manual
 * Override, C Conflicting Automation, D Missing Governance,
 * E Poor Data Quality). Given a persisted finding + its deserialized
 * metadata + the DetectorContext, returns 0..N attribution candidates.
 *
 * Tracers MUST be side-effect free — AttributionService owns the
 * insert. They MUST never throw on a single finding; return an empty
 * list and log if the finding shape is unexpected. One bad finding
 * cannot tank the whole tracer pipeline.
 */
public interface IAttributionTracer {
    /** Returns 'A' | 'B' | 'C' | 'D' | 'E'. */
    String getRootCauseClass();

    /**
     * @param finding   the persisted ForensicFinding__c row (Id non-null)
     * @param metadata  the deserialized Metadata__c JSON, never null
     * @param ctx       the DetectorContext for this scan
     */
    List<AttributionCandidate> trace(
        ForensicFinding__c finding,
        Map<String, Object> metadata,
        DetectorContext ctx
    );
}
