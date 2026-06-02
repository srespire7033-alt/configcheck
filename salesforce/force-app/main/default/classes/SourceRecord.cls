/**
 * Lightweight reference to a Salesforce record. Used by detectors
 * to tag findings with the offending record(s).
 *
 * Apex equivalent of the TypeScript SourceRecord interface.
 *
 * Privacy: store record names/numbers + IDs only — never person or
 * company names, never PII. The orchestrator serializes a list of
 * these into ForensicFinding__c.SourceRecordRefs__c as JSON.
 */
public class SourceRecord {
    public String sObjectType;       // e.g. 'Order', 'SBQQ__Subscription__c'
    public Id recordId;
    public String name;              // record Name (Quote Number, Order Number, etc.)
    public Map<String, Object> financials; // role-specific financial fields

    public SourceRecord(String sObjectType, Id recordId, String name) {
        this.sObjectType = sObjectType;
        this.recordId = recordId;
        this.name = name;
        this.financials = new Map<String, Object>();
    }

    /** Add a financial field for context (e.g., 'netTotal' → 50000). */
    public SourceRecord withFinancial(String key, Object value) {
        this.financials.put(key, value);
        return this;
    }
}
