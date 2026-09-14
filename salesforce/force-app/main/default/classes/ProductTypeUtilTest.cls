/**
 * Phase 27 — ProductType set semantics.
 *
 * Covers the utility, the detection matrix (via the @TestVisible schema-probe
 * cache, so no HTTP), and the persistence regression that the live
 * INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST crash would have tripped.
 */
@isTest
private class ProductTypeUtilTest {

    // ─── tokens() ───────────────────────────────────────────────────
    @isTest
    static void tokens_handlesNullBlankSingleMultiAndWhitespace() {
        System.assertEquals(0, ProductTypeUtil.tokens(null).size());
        System.assertEquals(0, ProductTypeUtil.tokens('').size());
        System.assertEquals(0, ProductTypeUtil.tokens('   ').size());

        System.assertEquals(new Set<String>{ 'CPQ' }, ProductTypeUtil.tokens('CPQ'));
        System.assertEquals(new Set<String>{ 'CPQ', 'ARM' }, ProductTypeUtil.tokens('CPQ;ARM'));
        System.assertEquals(new Set<String>{ 'CPQ', 'ARM' }, ProductTypeUtil.tokens('  CPQ ; ARM  '),
            'Tokens must be trimmed — stored multiselect values can carry spaces');
        System.assertEquals(new Set<String>{ 'CPQ' }, ProductTypeUtil.tokens('CPQ;;'),
            'Empty segments are dropped');
    }

    // ─── intersects() ───────────────────────────────────────────────
    @isTest
    static void intersects_blankEitherSideMeansNoFilter() {
        // Cast required: a bare null is ambiguous across the String and
        // Set<String> overloads.
        System.assertEquals(true, ProductTypeUtil.intersects((String) null, 'CPQ'));
        System.assertEquals(true, ProductTypeUtil.intersects('CPQ', null));
        System.assertEquals(true, ProductTypeUtil.intersects('', 'CPQ;ARM'));
        System.assertEquals(true, ProductTypeUtil.intersects('CPQ', ''));
    }

    @isTest
    static void intersects_matchesOnAnyOverlap() {
        // The whole point: a dual-stack org runs BOTH families.
        System.assertEquals(true, ProductTypeUtil.intersects('CPQ;CPQ+Billing', 'CPQ;ARM'),
            'CPQ detector must run on a CPQ+ARM org');
        System.assertEquals(true, ProductTypeUtil.intersects('ARM', 'CPQ;ARM'),
            'ARM detector must run on a CPQ+ARM org');
        System.assertEquals(false, ProductTypeUtil.intersects('ARM', 'CPQ'),
            'ARM-only detector must NOT run on a CPQ-only org');
        System.assertEquals(false, ProductTypeUtil.intersects('CPQ+Billing', 'CPQ;ARM'),
            'Billing detector must NOT run without the Billing package');
    }

    @isTest
    static void intersects_setOverloadMatchesStringOverload() {
        Set<String> declared = new Set<String>{ 'ARM', 'CPQ' };
        System.assertEquals(true, ProductTypeUtil.intersects(declared, 'CPQ;ARM'));
        System.assertEquals(true, ProductTypeUtil.intersects(declared, 'CPQ'));
        System.assertEquals(false, ProductTypeUtil.intersects(new Set<String>{ 'ARM' }, 'CPQ'));
        System.assertEquals(true, ProductTypeUtil.intersects(new Set<String>(), 'CPQ'),
            'Empty declared set = no filter');
    }

    // ─── has() / primary() ──────────────────────────────────────────
    @isTest
    static void hasAndPrimary_behaveAsDocumented() {
        System.assertEquals(true, ProductTypeUtil.has('CPQ;ARM', 'ARM'));
        System.assertEquals(false, ProductTypeUtil.has('CPQ;ARM', 'CPQ+Billing'));
        System.assertEquals('CPQ', ProductTypeUtil.primary('CPQ;ARM'));
        System.assertEquals('ARM', ProductTypeUtil.primary('ARM'));
        System.assertEquals('CPQ', ProductTypeUtil.primary('ARM;CPQ'),
            'primary() is precedence-ordered, not positional');
    }

    // ─── detectInstalledProductType() matrix ────────────────────────
    private static String detectWith(Set<String> present) {
        OrgQueryService.remoteSObjectCache.put('Stub_PT', present);
        return OrgQueryService.detectInstalledProductType('Stub_PT');
    }

    @isTest
    static void detect_singleStackOrgsAreUnchanged() {
        System.assertEquals('CPQ', detectWith(new Set<String>{ 'SBQQ__Quote__c' }),
            'CPQ dev-ed must not widen');
        System.assertEquals('ARM', detectWith(new Set<String>{ 'ProductSellingModel' }),
            'ARM org must stay ARM — presence survives permission gating');
    }

    @isTest
    static void detect_dualStackReturnsTheUnion() {
        // Billing needs no usage probe — blng__BillingRule__c only exists if the
        // managed package is installed, unlike the standard ProductSellingModel.
        System.assertEquals('CPQ;CPQ+Billing',
            detectWith(new Set<String>{ 'SBQQ__Quote__c', 'blng__BillingRule__c' }));
    }

    /** Controls whether the ARM-usage probe sees any ProductSellingModel rows. */
    private class PsmMock implements HttpCalloutMock {
        private final String body;
        private PsmMock(String b) { this.body = b; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(200);
            r.setBody(this.body);
            return r;
        }
    }

    @isTest
    static void detect_armProvisionedButEmpty_dropsArm() {
        // The SmartSheet case: CPQ package installed, Revenue Cloud merely
        // PROVISIONED, zero selling models. Before this, ARM-001 ("active
        // products have no selling model") flagged 1,810 products critical in
        // an org that simply does not use ARM.
        Test.setMock(HttpCalloutMock.class, new PsmMock('{"records":[]}'));
        System.assertEquals('CPQ',
            detectWith(new Set<String>{ 'SBQQ__Quote__c', 'ProductSellingModel' }),
            'Provisioned-but-unused ARM must not contribute the ARM token');
    }

    @isTest
    static void detect_armInUse_keepsBothStacks() {
        Test.setMock(HttpCalloutMock.class,
            new PsmMock('{"records":[{"Id":"0Pm000000000001AAA"}]}'));
        System.assertEquals('CPQ;ARM',
            detectWith(new Set<String>{ 'SBQQ__Quote__c', 'ProductSellingModel' }),
            'A genuinely dual-stack org keeps both families');
    }

    @isTest
    static void detect_armProbeThrows_keepsArm() {
        // No mock registered -> the callout throws -> UNKNOWN. This is the
        // permission-gated ARM org (ProductSellingModel present but not
        // SOQL-queryable); demoting it on a throw would be the real bug.
        System.assertEquals('CPQ;ARM',
            detectWith(new Set<String>{ 'SBQQ__Quote__c', 'ProductSellingModel' }),
            'A throw is UNKNOWN, never "no rows" — ARM must survive');
    }

    @isTest
    static void detect_armOnlyOrgNeverProbesOrDemotes() {
        // hasCpq is false, so there is no ambiguity and no callout to make.
        System.assertEquals('ARM',
            detectWith(new Set<String>{ 'ProductSellingModel' }),
            'An ARM-only org stays ARM even with an empty surface');
    }

    @isTest
    static void detect_neverReturnsBareBillingToken() {
        // Regression: 'Billing' matched 0 of 229 detectors AND was absent from
        // ForensicScan__c's restricted value set, so it threw on scan insert.
        String result = detectWith(new Set<String>{ 'blng__BillingRule__c' });
        System.assertNotEquals('Billing', result, 'Bare Billing token must never be emitted');
        System.assertEquals('CPQ+Billing', result);
    }

    @isTest
    static void detect_noneAndProbeFailureInvariants() {
        System.assertEquals('None', detectWith(new Set<String>()),
            'None only when every marker is absent');
        OrgQueryService.remoteSObjectCache.put('Stub_Failed', null);
        System.assertEquals(null, OrgQueryService.detectInstalledProductType('Stub_Failed'),
            'Probe failure returns null so callers preserve the stored value');
    }

    // ─── persistence regression (guards the field conversion) ───────
    @isTest
    static void forensicScanAcceptsEveryEmittableTokenSet() {
        List<ForensicScan__c> scans = new List<ForensicScan__c>();
        for (String v : new List<String>{ 'CPQ', 'CPQ;ARM', 'CPQ;CPQ+Billing;ARM', 'CPQ+Billing', 'None' }) {
            scans.add(new ForensicScan__c(Status__c = 'Running', ProductType__c = v));
        }
        Test.startTest();
        insert scans;   // would throw INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST pre-Phase-27
        Test.stopTest();
        System.assertEquals(5, [SELECT COUNT() FROM ForensicScan__c WHERE Id IN :scans]);
    }
}
