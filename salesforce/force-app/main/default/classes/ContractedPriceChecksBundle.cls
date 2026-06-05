/**
 * Phase 22a-4 — 3 checks on SBQQ__ContractedPrice__c.
 *
 *   CP-001 — Issues: expired / inactive-product / zero-price (3 sub-findings, warning)
 *   CP-002 — Both Effective AND Expiration date missing (critical, aggregated)
 *   CP-003 — No source quote line, indicates manual data entry (info, aggregated)
 *
 * SOQL: 1 query.
 */
public with sharing class ContractedPriceChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'CP-BUNDLE'; }
    public String getLabel() { return 'Contracted Price health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ContractedPrice__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] CP-BUNDLE: SBQQ__ContractedPrice__c not present.');
                return results;
            }
            // CP-003 needs SBQQ__OriginalQuoteLine__c — older CPQ versions may not have it.
            Boolean hasOrigQL = SchemaUtil.hasField('SBQQ__ContractedPrice__c', 'SBQQ__OriginalQuoteLine__c');
            String soql =
                'SELECT Id, SBQQ__Price__c, SBQQ__EffectiveDate__c, SBQQ__ExpirationDate__c, ' +
                '  SBQQ__Account__c, SBQQ__Account__r.Name, ' +
                '  SBQQ__Product__c, SBQQ__Product__r.Name, SBQQ__Product__r.IsActive' +
                (hasOrigQL ? ', SBQQ__OriginalQuoteLine__c' : '') +
                ' FROM SBQQ__ContractedPrice__c LIMIT 5000';
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] CP-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runCP001 = DetectorCatalogController.isActive('CP-001');
        Boolean runCP002 = DetectorCatalogController.isActive('CP-002');
        Boolean runCP003 = DetectorCatalogController.isActive('CP-003');

        if (runCP001) results.addAll(evaluateCP001(rows));
        if (runCP002) results.addAll(evaluateCP002(rows));
        if (runCP003) results.addAll(evaluateCP003(rows));
        return results;
    }

    static SourceRecord cpRef(Map<String, Object> cp) {
        String n = displayName(cp);
        return new SourceRecord('SBQQ__ContractedPrice__c', (Id) cp.get('Id'), n);
    }
    static String displayName(Map<String, Object> cp) {
        String acct = nestedName(cp, 'SBQQ__Account__r');
        String prod = nestedName(cp, 'SBQQ__Product__r');
        return (acct == null ? 'Unknown' : acct) + ' - ' + (prod == null ? 'Unknown' : prod);
    }
    static String nestedName(Map<String, Object> cp, String rel) {
        Object o = cp.get(rel);
        if (o == null || !(o instanceof Map<String, Object>)) return null;
        Object n = ((Map<String, Object>) o).get('Name');
        return (n == null) ? null : String.valueOf(n);
    }
    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    // ── CP-001: expired / inactive-product / zero-price (3 emissions) ─

    @TestVisible
    static List<DetectorResult> evaluateCP001(List<Map<String, Object>> cps) {
        Date todayDate = Date.today();
        List<Map<String, Object>> expired = new List<Map<String, Object>>();
        List<Map<String, Object>> inactiveProd = new List<Map<String, Object>>();
        List<Map<String, Object>> zeroPrice = new List<Map<String, Object>>();
        for (Map<String, Object> cp : cps) {
            Date exp = parseD(cp.get('SBQQ__ExpirationDate__c'));
            // Expired: ExpirationDate != null AND < today
            if (exp != null && exp < todayDate) expired.add(cp);
            // Inactive product (strict false)
            Object prodObj = cp.get('SBQQ__Product__r');
            if (prodObj != null && prodObj instanceof Map<String, Object>) {
                Object active = ((Map<String, Object>) prodObj).get('IsActive');
                if (active != null && Boolean.valueOf(active) == false) inactiveProd.add(cp);
            }
            // Zero/null price (still active)
            Object priceObj = cp.get('SBQQ__Price__c');
            Boolean isZero = (priceObj == null) || (Decimal.valueOf(String.valueOf(priceObj)) == 0);
            Boolean stillActive = (exp == null || exp >= todayDate);
            if (isZero && stillActive) zeroPrice.add(cp);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        if (!expired.isEmpty()) {
            out.add(buildCP001(expired, 'expired',
                expired.size() + ' expired contracted price(s) found',
                expired.size() + ' contracted price(s) have expiration dates in the past. They still apply to quotes unless deactivated.',
                'Customers may still receive expired contracted pricing.',
                'Deactivate or update expired contracted prices.',
                null));
        }
        if (!inactiveProd.isEmpty()) {
            out.add(buildCP001(inactiveProd, 'inactiveProduct',
                inactiveProd.size() + ' contracted price(s) reference inactive products',
                inactiveProd.size() + ' contracted price(s) point to products marked IsActive=false. The pricing will never apply.',
                'Dead configuration. May confuse admins reviewing the setup.',
                'Either reactivate the products or delete the contracted prices.',
                null));
        }
        if (!zeroPrice.isEmpty()) {
            out.add(buildCP001(zeroPrice, 'zeroPrice',
                zeroPrice.size() + ' active contracted price(s) with zero or null price',
                zeroPrice.size() + ' active contracted price(s) have a zero or missing price. Customers will receive these products free.',
                'Revenue leakage. Customers may exploit the zero pricing.',
                'Review each zero-priced contracted price and either set a price or deactivate.',
                Decimal.valueOf(zeroPrice.size() * 200)));
        }
        return out;
    }

    static DetectorResult buildCP001(List<Map<String, Object>> cps, String tag,
            String title, String descr, String impact, String rec, Decimal revImpact) {
        DetectorResult r = new DetectorResult();
        r.detectorId = 'CP-001';
        r.severity = 'Warning';
        r.gapUsd = (revImpact != null) ? revImpact : 0;
        r.recoverabilityScore = 0.85;
        r.title = title;
        r.description = descr + ' Impact: ' + impact + ' Recommendation: ' + rec;
        r.primaryRecord = cpRef(cps[0]);
        Integer cap = Math.min(20, cps.size());
        for (Integer i = 1; i < cap; i++) r.supportingRecords.add(cpRef(cps[i]));
        return r;
    }

    // ── CP-002: both dates null ───────────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateCP002(List<Map<String, Object>> cps) {
        List<Map<String, Object>> noDate = new List<Map<String, Object>>();
        for (Map<String, Object> cp : cps) {
            if (cp.get('SBQQ__EffectiveDate__c') == null && cp.get('SBQQ__ExpirationDate__c') == null) {
                noDate.add(cp);
            }
        }
        if (noDate.isEmpty()) return new List<DetectorResult>();
        DetectorResult r = new DetectorResult();
        r.detectorId = 'CP-002';
        r.severity = 'Critical';
        r.gapUsd = 0;
        r.recoverabilityScore = 0.9;
        r.title = noDate.size() + ' contracted price(s) without effective or expiration date';
        r.description = 'Found ' + noDate.size() + ' contracted price record(s) with neither effective date nor expiration date set. ' +
            'These prices apply indefinitely and may override standard pricing unexpectedly.';
        r.primaryRecord = cpRef(noDate[0]);
        Integer cap = Math.min(20, noDate.size());
        for (Integer i = 1; i < cap; i++) r.supportingRecords.add(cpRef(noDate[i]));
        return new List<DetectorResult>{ r };
    }

    // ── CP-003: no source quote line ──────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateCP003(List<Map<String, Object>> cps) {
        List<Map<String, Object>> noSource = new List<Map<String, Object>>();
        for (Map<String, Object> cp : cps) {
            if (!cp.containsKey('SBQQ__OriginalQuoteLine__c')) continue; // field absent → skip
            if (cp.get('SBQQ__OriginalQuoteLine__c') == null) noSource.add(cp);
        }
        if (noSource.isEmpty()) return new List<DetectorResult>();
        DetectorResult r = new DetectorResult();
        r.detectorId = 'CP-003';
        r.severity = 'Info';
        r.gapUsd = 0;
        r.recoverabilityScore = 1.0;
        r.title = noSource.size() + ' contracted price(s) without source quote line';
        r.description = 'Found ' + noSource.size() + ' contracted price(s) that were not created from a quote line. ' +
            'These were likely created manually or via data load, making them harder to audit and trace.';
        r.primaryRecord = cpRef(noSource[0]);
        Integer cap = Math.min(10, noSource.size());
        for (Integer i = 1; i < cap; i++) r.supportingRecords.add(cpRef(noSource[i]));
        return new List<DetectorResult>{ r };
    }
}
