/** Phase 22c-3 — CostBook: ARM-049..051. */
public with sharing class ArmCostBookChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubBooks;
    @TestVisible static List<Map<String, Object>> testStubEntries;

    public String getDetectorId() { return 'ARM-COSTBOOK-BUNDLE'; }
    public String getLabel() { return 'ARM Cost Book checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> books, entries;
        Boolean usingStubs = (testStubBooks != null || testStubEntries != null);
        if (usingStubs) {
            books   = testStubBooks   != null ? testStubBooks   : new List<Map<String, Object>>();
            entries = testStubEntries != null ? testStubEntries : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('CostBook')) return results;
            try {
                String curField = SchemaUtil.hasField('CostBook', 'CurrencyIsoCode') ? ', CurrencyIsoCode' : '';
                String stdField = SchemaUtil.hasField('CostBook', 'IsStandard') ? ', IsStandard' : '';
                books = OrgQueryService.query(ctx,
                    'SELECT Id, Name, IsActive' + curField + stdField + ' FROM CostBook LIMIT 5000');
                entries = SchemaUtil.hasObject('CostBookEntry')
                    ? OrgQueryService.query(ctx, 'SELECT Id, CostBookId, Cost FROM CostBookEntry LIMIT 10000')
                    : new List<Map<String, Object>>();
            } catch (Exception e) { return results; }
        }
        if (DetectorCatalogController.isActive('ARM-049')) results.addAll(evaluateARM049(books, entries));
        if (DetectorCatalogController.isActive('ARM-050')) results.addAll(evaluateARM050(entries));
        if (DetectorCatalogController.isActive('ARM-051')) results.addAll(evaluateARM051(books));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM049(List<Map<String, Object>> books, List<Map<String, Object>> entries) {
        Set<Id> withEntries = new Set<Id>();
        for (Map<String, Object> e : entries) {
            Object cid = e.get('CostBookId');
            if (cid != null) withEntries.add((Id) cid);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> b : books) {
            Object active = b.get('IsActive');
            if (active != null && !Boolean.valueOf(active)) continue;
            if (withEntries.contains((Id) b.get('Id'))) continue;
            bad.add(new SourceRecord('CostBook', (Id) b.get('Id'), String.valueOf(b.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-049', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-049'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' active cost book(s) with no entries');
            dr.description = 'Cost books without entries cannot supply COGS data.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM050(List<Map<String, Object>> entries) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> e : entries) {
            Object c = e.get('Cost');
            Decimal v = c == null ? null : (Decimal) c;
            if (v != null && v != 0) continue;
            bad.add(new SourceRecord('CostBookEntry', (Id) e.get('Id'), 'Entry'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-050', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-050'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' cost book entry/entries with no cost');
            dr.description = 'Entries with null/zero cost produce no margin data.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM051(List<Map<String, Object>> books) {
        Map<String, List<Map<String, Object>>> byCurrency = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> b : books) {
            if (!Boolean.valueOf(b.get('IsActive'))) continue;
            Object std = b.get('IsStandard');
            if (std != null && Boolean.valueOf(std)) continue;
            String cur = b.containsKey('CurrencyIsoCode') && b.get('CurrencyIsoCode') != null
                ? String.valueOf(b.get('CurrencyIsoCode')) : 'NONE';
            if (!byCurrency.containsKey(cur)) byCurrency.put(cur, new List<Map<String, Object>>());
            byCurrency.get(cur).add(b);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        Integer currencies = 0;
        for (String cur : byCurrency.keySet()) {
            List<Map<String, Object>> grp = byCurrency.get(cur);
            if (grp.size() <= 1) continue;
            currencies++;
            for (Map<String, Object> b : grp) bad.add(new SourceRecord('CostBook', (Id) b.get('Id'),
                cur + ': "' + String.valueOf(b.get('Name')) + '"'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-051', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-051'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (currencies + ' currency/currencies with multiple active cost books');
            dr.description = 'Multiple active cost books per currency complicate margin reporting.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
