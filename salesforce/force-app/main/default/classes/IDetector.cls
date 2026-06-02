/**
 * Contract every OrgPrism forensic detector implements.
 *
 * A detector reads transactional Salesforce data (Quotes, Orders,
 * Subscriptions, Assets, Contracts) and emits zero-or-more
 * DetectorResult records for each leaking row it finds.
 *
 * Detectors are stateless — they don't persist anything themselves.
 * The orchestrator (ForensicScanService) is responsible for taking
 * a detector's output and writing it into ForensicFinding__c rows
 * tied to a ForensicScan__c.
 */
public interface IDetector {
    /** Stable identifier — REN-001, DSC-FOR-001, etc. Used as DetectorId__c on findings. */
    String getDetectorId();

    /** Human-readable label shown to the user. */
    String getLabel();

    /** Which product types this detector applies to. Returns a Set of 'CPQ' / 'CPQ+Billing' / 'ARM'. */
    Set<String> getAppliesTo();

    /**
     * Run the detector against the org and return zero-or-more findings.
     * The context provides the scan's currency, the product type, and
     * any cached record snapshots from earlier in the same scan run.
     */
    List<DetectorResult> run(DetectorContext ctx);
}
