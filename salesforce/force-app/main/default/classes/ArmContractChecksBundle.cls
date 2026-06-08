/** Phase 22c-3 — Contract + ContractItemPrice: ARM-036..039. */
public with sharing class ArmContractChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubContracts;
    @TestVisible static List<Map<String, Object>> testStubItemPrices;

    public String getDetectorId() { return 'ARM-CONTRACT-BUNDLE'; }
    public String getLabel() { return 'ARM Contract checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> contracts, prices;
        Boolean usingStubs = (testStubContracts != null || testStubItemPrices != null);
        if (usingStubs) {
            contracts = testStubContracts != null ? testStubContracts : new List<Map<String, Object>>();
            prices    = testStubItemPrices != null ? testStubItemPrices : new List<Map<String, Object>>();
        } else {
            // Gate on ContextDefinition (ARM presence) — Contract is universal.
            if (!ctx.isRemote() && !SchemaUtil.hasObject('ContextDefinition')) return results;
            try {
                contracts = OrgQueryService.query(ctx,
                    'SELECT Id, ContractNumber, Status, StartDate, EndDate FROM Contract LIMIT 10000');
                prices = SchemaUtil.hasObject('ContractItemPrice')
                    ? OrgQueryService.query(ctx,
                        'SELECT Id, Name, Price, EffectiveStartDate, EffectiveEndDate FROM ContractItemPrice LIMIT 10000')
                    : new List<Map<String, Object>>();
            } catch (Exception e) { return results; }
        }
        // ARM-036 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-036')) results.addAll(evaluateARM036(prices));
        // ARM-037 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-037')) results.addAll(evaluateARM037(contracts));
        // ARM-038 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-038')) results.addAll(evaluateARM038(prices));
        // ARM-039 migrated to CustomDetector__mdt (Phase 24i).
        // if (DetectorCatalogController.isActive('ARM-039')) results.addAll(evaluateARM039(contracts));
        return results;
    }

    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM036(List<Map<String, Object>> prices) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : prices) {
            if (p.get('EffectiveStartDate') != null || p.get('EffectiveEndDate') != null) continue;
            bad.add(new SourceRecord('ContractItemPrice', (Id) p.get('Id'),
                String.valueOf(p.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-036', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-036'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' contract item price(s) without effective dates');
            dr.description = 'Without dates, contract pricing may persist indefinitely or never engage.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM037(List<Map<String, Object>> contracts) {
        Date td = Date.today();
        Set<String> active = new Set<String>{ 'Activated', 'Active' };
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : contracts) {
            if (!active.contains(String.valueOf(c.get('Status')))) continue;
            Date ed = parseD(c.get('EndDate'));
            if (ed == null || !(ed < td)) continue;
            bad.add(new SourceRecord('Contract', (Id) c.get('Id'),
                String.valueOf(c.get('ContractNumber')) + ' (ended ' + ed + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-037', 'Info');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-037'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
            dr.title = '"' + dsr.name + '" — ' + (' active contract(s) past end date');
            dr.description = 'Contracts past EndDate should be renewed or set to Expired.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM038(List<Map<String, Object>> prices) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : prices) {
            Object pr = p.get('Price');
            Decimal v = pr == null ? null : (Decimal) pr;
            if (v != null && v > 0) continue;
            bad.add(new SourceRecord('ContractItemPrice', (Id) p.get('Id'), String.valueOf(p.get('Name'))));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-038', 'Warning');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-038'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = '"' + dsr.name + '" — ' + (' contract item price(s) zero or negative');
            dr.description = 'Zero/negative prices on contract items will not generate revenue.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM039(List<Map<String, Object>> contracts) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : contracts) {
            Date sd = parseD(c.get('StartDate'));
            Date ed = parseD(c.get('EndDate'));
            if (sd == null || ed == null) continue;
            if (!(sd > ed)) continue;
            bad.add(new SourceRecord('Contract', (Id) c.get('Id'),
                String.valueOf(c.get('ContractNumber')) + ' (' + sd + ' > ' + ed + ')'));
        }
        List<DetectorResult> dout = new List<DetectorResult>();
        String dsev = DetectorCatalogController.getSeverity('ARM-039', 'Critical');
        for (SourceRecord dsr : bad) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'ARM-039'; dr.severity = dsev; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = '"' + dsr.name + '" — ' + (' contract(s) with reversed dates');
            dr.description = 'StartDate is after EndDate — data entry error.';
            dr.primaryRecord = dsr;
            dout.add(dr);
        }
        return dout;
    }
}
