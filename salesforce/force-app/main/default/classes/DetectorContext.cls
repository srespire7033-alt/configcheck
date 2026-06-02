/**
 * What a detector receives at invocation time. Wraps the
 * orchestrator's state so detectors don't reach into globals.
 *
 * Snapshots: detectors that need the same records can share a
 * single pull. The orchestrator pre-populates common pulls (e.g.
 * all SBQQ__Subscription__c records) and detectors retrieve them
 * via getSnapshot('SBQQ__Subscription__c').
 */
public class DetectorContext {
    public Id scanId { get; private set; }
    public String defaultCurrency { get; private set; }
    public String productType { get; private set; }

    /** sObject name → records list. Populated by the orchestrator. */
    private Map<String, List<SObject>> snapshots;

    public DetectorContext(Id scanId, String defaultCurrency, String productType) {
        this.scanId = scanId;
        this.defaultCurrency = (defaultCurrency != null) ? defaultCurrency : 'USD';
        this.productType = productType;
        this.snapshots = new Map<String, List<SObject>>();
    }

    /** Cache a snapshot for downstream detectors. */
    public void putSnapshot(String sObjectName, List<SObject> records) {
        snapshots.put(sObjectName, records);
    }

    /** Get a cached snapshot, or null if not yet populated. */
    public List<SObject> getSnapshot(String sObjectName) {
        return snapshots.get(sObjectName);
    }

    public Boolean hasSnapshot(String sObjectName) {
        return snapshots.containsKey(sObjectName);
    }
}
