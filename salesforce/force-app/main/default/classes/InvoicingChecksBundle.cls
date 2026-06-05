/**
 * Phase 22b-1 — Bundle of 5 Invoicing checks.
 *
 *   INV-001 — Invoices stuck in Draft for 30+ days
 *   INV-002 — Posted invoices with $0 amount (strict zero)
 *   INV-003 — Credit notes with unallocated balance (> 0)
 *   INV-004 — Significant number of overdue invoices (gate: count > 10)
 *   INV-005 — Posted invoices without legal entity
 *
 * SOQL: 1 query on `blng__Invoice__c` + 1 on `blng__CreditNote__c` (gated).
 */
public with sharing class InvoicingChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubInvoices;
    @TestVisible static List<Map<String, Object>> testStubCreditNotes;

    public String getDetectorId() { return 'INV-BUNDLE'; }
    public String getLabel() { return 'Invoicing health checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ+Billing', 'ARM' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> invoices;
        List<Map<String, Object>> creditNotes;

        if (testStubInvoices != null || testStubCreditNotes != null) {
            invoices = (testStubInvoices != null) ? testStubInvoices : new List<Map<String, Object>>();
            creditNotes = (testStubCreditNotes != null) ? testStubCreditNotes : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__Invoice__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] INV-BUNDLE: blng__Invoice__c not present.');
                return results;
            }
            invoices = queryInvoices(ctx);
            creditNotes = queryCreditNotes(ctx);
            if (invoices == null) return results;
            if (creditNotes == null) creditNotes = new List<Map<String, Object>>();
        }

        Boolean runINV001 = DetectorCatalogController.isActive('INV-001');
        Boolean runINV002 = DetectorCatalogController.isActive('INV-002');
        Boolean runINV003 = DetectorCatalogController.isActive('INV-003');
        Boolean runINV004 = DetectorCatalogController.isActive('INV-004');
        Boolean runINV005 = DetectorCatalogController.isActive('INV-005');

        if (runINV001) results.addAll(evaluateINV001(invoices));
        if (runINV002) results.addAll(evaluateINV002(invoices));
        if (runINV003) results.addAll(evaluateINV003(creditNotes));
        if (runINV004) results.addAll(evaluateINV004(invoices));
        if (runINV005) results.addAll(evaluateINV005(invoices));
        return results;
    }

    // ── data fetch ────────────────────────────────────────────────

    @TestVisible
    static List<Map<String, Object>> queryInvoices(DetectorContext ctx) {
        Boolean hasLegal = SchemaUtil.hasField('blng__Invoice__c', 'blng__LegalEntity__c');
        String soql = 'SELECT Id, Name, blng__InvoiceStatus__c, blng__TotalAmount__c, ' +
                      'blng__DueDate__c, CreatedDate' +
                      (hasLegal ? ', blng__LegalEntity__c' : '') +
                      ' FROM blng__Invoice__c LIMIT 5000';
        try { return OrgQueryService.query(ctx, soql); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] INV-BUNDLE invoices: ' + e.getMessage());
            return null;
        }
    }

    @TestVisible
    static List<Map<String, Object>> queryCreditNotes(DetectorContext ctx) {
        if (!SchemaUtil.hasObject('blng__CreditNote__c')) return new List<Map<String, Object>>();
        try {
            return OrgQueryService.query(ctx,
                'SELECT Id, Name, blng__Balance__c FROM blng__CreditNote__c WHERE blng__Balance__c > 0 LIMIT 5000');
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] INV-BUNDLE credit notes: ' + e.getMessage());
            return new List<Map<String, Object>>();
        }
    }

    // ── helpers ────────────────────────────────────────────────────

    static SourceRecord invRef(Map<String, Object> i) {
        return new SourceRecord('blng__Invoice__c', (Id) i.get('Id'), (String) i.get('Name'));
    }
    static SourceRecord cnRef(Map<String, Object> c) {
        return new SourceRecord('blng__CreditNote__c', (Id) c.get('Id'), (String) c.get('Name'));
    }
    static String status(Map<String, Object> i) {
        Object o = i.get('blng__InvoiceStatus__c');
        return (o == null) ? null : String.valueOf(o);
    }
    static Decimal amt(Map<String, Object> i, String key) {
        Object o = i.get(key);
        return (o == null) ? 0 : Decimal.valueOf(String.valueOf(o));
    }
    static String fmtMoney(Decimal amount) {
        return amount.setScale(2).format();
    }

    /** OrgQueryService.query returns dates as ISO-8601 Strings (from JSON
     *  deserialise). Local SOQL returns native Datetime. Handle both. */
    static Datetime parseDt(Object o) {
        if (o == null) return null;
        if (o instanceof Datetime) return (Datetime) o;
        String s = String.valueOf(o);
        // ISO "2026-06-05T03:42:00.000Z" → Datetime.valueOfGmt needs "2026-06-05 03:42:00".
        s = s.replace('T', ' ').replace('Z', '');
        if (s.length() > 19) s = s.substring(0, 19);
        try { return Datetime.valueOfGmt(s); }
        catch (Exception e) { return null; }
    }
    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        // ISO "2026-06-05" — Date.valueOf wants "YYYY-MM-DD".
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); }
        catch (Exception e) { return null; }
    }

    // ── INV-001: stuck drafts 30+ days ────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateINV001(List<Map<String, Object>> invoices) {
        Datetime cutoff = System.now().addDays(-30);
        List<Map<String, Object>> stuck = new List<Map<String, Object>>();
        Decimal total = 0;
        for (Map<String, Object> i : invoices) {
            if (status(i) != 'Draft') continue;
            Datetime created = parseDt(i.get('CreatedDate'));
            if (created == null || created >= cutoff) continue;
            stuck.add(i);
            total += amt(i, 'blng__TotalAmount__c');
        }
        if (stuck.isEmpty()) return new List<DetectorResult>();
        List<SourceRecord> refs = new List<SourceRecord>();
        for (Map<String, Object> i : stuck) refs.add(invRef(i));

        DetectorResult r = new DetectorResult();
        r.detectorId = 'INV-001';
        r.severity = 'Warning';
        r.gapUsd = total;
        r.recoverabilityScore = 0.7;
        r.title = 'Invoices stuck in Draft for 30+ days';
        r.description = stuck.size() + ' invoice(s) have been in Draft status for more than 30 days. These need to be posted or cancelled.';
        r.primaryRecord = refs[0];
        Integer cap = Math.min(50, refs.size());
        for (Integer k = 1; k < cap; k++) r.supportingRecords.add(refs[k]);
        return new List<DetectorResult>{ r };
    }

    // ── INV-002: posted, $0 (strict zero) ─────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateINV002(List<Map<String, Object>> invoices) {
        List<SourceRecord> zeros = new List<SourceRecord>();
        for (Map<String, Object> i : invoices) {
            if (status(i) != 'Posted') continue;
            Object ta = i.get('blng__TotalAmount__c');
            if (ta == null) continue; // strict zero: null is NOT zero
            if (Decimal.valueOf(String.valueOf(ta)) != 0) continue;
            zeros.add(invRef(i));
        }
        if (zeros.isEmpty()) return new List<DetectorResult>();
        DetectorResult r = new DetectorResult();
        r.detectorId = 'INV-002';
        r.severity = 'Warning';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.7;
        r.title = 'Posted invoices with $0 amount';
        r.description = zeros.size() + ' posted invoice(s) have a $0 total. May indicate duplicate or erroneous invoice generation.';
        r.primaryRecord = zeros[0];
        Integer cap = Math.min(50, zeros.size());
        for (Integer k = 1; k < cap; k++) r.supportingRecords.add(zeros[k]);
        return new List<DetectorResult>{ r };
    }

    // ── INV-003: credit notes with unallocated balance ────────────

    @TestVisible
    static List<DetectorResult> evaluateINV003(List<Map<String, Object>> creditNotes) {
        if (creditNotes == null || creditNotes.isEmpty()) return new List<DetectorResult>();
        Decimal total = 0;
        for (Map<String, Object> c : creditNotes) total += amt(c, 'blng__Balance__c');
        if (total <= 0) return new List<DetectorResult>();
        List<SourceRecord> refs = new List<SourceRecord>();
        for (Map<String, Object> c : creditNotes) refs.add(cnRef(c));
        DetectorResult r = new DetectorResult();
        r.detectorId = 'INV-003';
        r.severity = 'Warning';
        r.gapUsd = total;
        r.recoverabilityScore = 0.8;
        r.title = 'Credit notes with unallocated balance';
        r.description = creditNotes.size() + ' credit note(s) have unallocated balance totaling $' + fmtMoney(total) +
            '. These credits have not been applied to invoices.';
        r.primaryRecord = refs[0];
        Integer cap = Math.min(50, refs.size());
        for (Integer k = 1; k < cap; k++) r.supportingRecords.add(refs[k]);
        return new List<DetectorResult>{ r };
    }

    // ── INV-004: significant overdue (gate: count > 10) ──────────

    @TestVisible
    static List<DetectorResult> evaluateINV004(List<Map<String, Object>> invoices) {
        Date today = Date.today();
        List<Map<String, Object>> overdue = new List<Map<String, Object>>();
        Decimal total = 0;
        for (Map<String, Object> i : invoices) {
            if (status(i) != 'Posted') continue;
            Date due = parseD(i.get('blng__DueDate__c'));
            if (due == null || !(due < today)) continue;
            overdue.add(i);
            total += amt(i, 'blng__TotalAmount__c');
        }
        if (overdue.size() <= 10) return new List<DetectorResult>(); // gate
        List<SourceRecord> refs = new List<SourceRecord>();
        for (Map<String, Object> i : overdue) refs.add(invRef(i));
        DetectorResult r = new DetectorResult();
        r.detectorId = 'INV-004';
        r.severity = 'Info';
        r.gapUsd = total;
        r.recoverabilityScore = 0.6;
        r.title = 'Significant number of overdue invoices';
        r.description = overdue.size() + ' posted invoice(s) are past their due date, totaling $' + fmtMoney(total) + '.';
        r.primaryRecord = refs[0];
        Integer cap = Math.min(50, refs.size());
        for (Integer k = 1; k < cap; k++) r.supportingRecords.add(refs[k]);
        return new List<DetectorResult>{ r };
    }

    // ── INV-005: posted invoices without legal entity ────────────

    @TestVisible
    static List<DetectorResult> evaluateINV005(List<Map<String, Object>> invoices) {
        List<SourceRecord> missing = new List<SourceRecord>();
        Boolean hasField = false;
        for (Map<String, Object> i : invoices) {
            if (status(i) != 'Posted') continue;
            // Detect field presence by whether any row has the key at all.
            if (i.containsKey('blng__LegalEntity__c')) hasField = true;
            if (i.get('blng__LegalEntity__c') == null && (hasField || i.containsKey('blng__LegalEntity__c'))) {
                missing.add(invRef(i));
            }
        }
        // If the field isn't present in any row, skip — we don't have ground truth.
        if (!hasField || missing.isEmpty()) return new List<DetectorResult>();
        DetectorResult r = new DetectorResult();
        r.detectorId = 'INV-005';
        r.severity = 'Critical';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.85;
        r.title = missing.size() + ' posted invoice(s) without legal entity';
        r.description = missing.size() +
            ' posted invoice(s) have no legal entity assigned. Invoices without a legal entity lack the company information required for tax compliance.';
        r.primaryRecord = missing[0];
        Integer cap = Math.min(50, missing.size());
        for (Integer k = 1; k < cap; k++) r.supportingRecords.add(missing[k]);
        return new List<DetectorResult>{ r };
    }
}
