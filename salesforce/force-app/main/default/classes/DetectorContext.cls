/**
 * What a detector receives at invocation time. Wraps the
 * orchestrator's state so detectors don't reach into globals.
 *
 * Snapshots: detectors that need the same records can share a
 * single pull. The orchestrator pre-populates common pulls (e.g.
 * all SBQQ__Subscription__c records) and detectors retrieve them
 * via getSnapshot('SBQQ__Subscription__c').
 *
 * Phase 7 — remote scanning: a non-null connectedOrgId tells
 * downstream services (OrgQueryService) to route SOQL via a
 * Named Credential REST callout against a different org. When
 * null, all queries run against the local org (legacy behavior).
 */
public class DetectorContext {
    public Id scanId { get; private set; }
    public String defaultCurrency { get; private set; }
    public String productType { get; private set; }

    /** Optional — when set, detectors run against the remote org via Named Credential. */
    public Id connectedOrgId { get; private set; }
    /** Optional — cached Named Credential name for the connected org (saves a SOQL hop). */
    public String namedCredentialName { get; private set; }

    /** sObject name → records list. Populated by the orchestrator. */
    private Map<String, List<SObject>> snapshots;

    public DetectorContext(Id scanId, String defaultCurrency, String productType) {
        this(scanId, defaultCurrency, productType, null, null);
    }

    public DetectorContext(Id scanId, String defaultCurrency, String productType,
                           Id connectedOrgId, String namedCredentialName) {
        this.scanId = scanId;
        this.defaultCurrency = (defaultCurrency != null) ? defaultCurrency : 'USD';
        this.productType = productType;
        this.connectedOrgId = connectedOrgId;
        this.namedCredentialName = namedCredentialName;
        this.snapshots = new Map<String, List<SObject>>();
    }

    /** True when this scan is targeting a remote org (i.e. queries go via callout). */
    public Boolean isRemote() {
        return this.connectedOrgId != null && String.isNotBlank(this.namedCredentialName);
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
