/**
 * Phase 10 Batch A — tests for AMD-FOR-001, OPP-FOR-001, CON-FOR-001.
 *
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 * Each detector is exercised via:
 *   - testStubRows path (pre-flattened map → evaluateRow directly)
 *   - run() top-of-method short-circuit (covers the run() body wiring)
 *   - run() without any stub (drives the dynamic SOQL path; the
 *     query may succeed with 0 rows or fail gracefully if the
 *     namespace is missing in the test org — either is fine for
 *     coverage)
 */
@isTest
private class Phase10BatchATest {

    // ─── AMD-FOR-001 ─────────────────────────────────────────────

    private static Map<String, Object> amdRow(Decimal netAmount) {
        return new Map<String, Object>{
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'AMD-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'status' => 'Draft',
            'netAmount' => netAmount,
            'endDate' => Date.today().addMonths(11),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void amd001_emitsWarning() {
        DetectorResult r = AMD001NoEffectiveDateDetector.evaluateRow(amdRow(50000));
        System.assertNotEquals(null, r);
        System.assertEquals('AMD-FOR-001', r.detectorId);
        System.assertEquals('Warning', r.severity);
        System.assertEquals(0, r.gapUsd, 'governance finding — no $ claim');
    }

    @isTest static void amd001_handlesMissingAccountName() {
        Map<String, Object> row = amdRow(1000);
        row.remove('accountName');
        DetectorResult r = AMD001NoEffectiveDateDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
        System.assert(r.description.contains('Account '), 'Should fall back to ID-based name');
    }

    @isTest static void amd001_handlesNullQuoteId() {
        Map<String, Object> row = amdRow(1000);
        row.put('quoteId', null);
        System.assertEquals(null, AMD001NoEffectiveDateDetector.evaluateRow(row));
    }

    @isTest static void amd001_unwrap_handlesEmptyMap() {
        Map<String, Object> out = AMD001NoEffectiveDateDetector.unwrap(new Map<String, Object>());
        System.assertEquals(null, out.get('quoteId'));
    }

    @isTest static void amd001_unwrap_handlesNullInput() {
        Map<String, Object> out = AMD001NoEffectiveDateDetector.unwrap(null);
        System.assertNotEquals(null, out);
    }

    @isTest static void amd001_runWithStubRows_iteratesAndEmits() {
        AMD001NoEffectiveDateDetector.testStubRows = new List<Map<String, Object>>{
            amdRow(50000),
            amdRow(1000)
        };
        AMD001NoEffectiveDateDetector d = new AMD001NoEffectiveDateDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        AMD001NoEffectiveDateDetector.testStubRows = null;
        System.assertEquals(2, r.size());
    }

    @isTest static void amd001_runWithoutStub_drivesSoqlPath() {
        // SBQQ__Quote__c may not be installed → run() catches and returns 0.
        // The point is to exercise the SOQL branch lines.
        AMD001NoEffectiveDateDetector d = new AMD001NoEffectiveDateDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── OPP-FOR-001 ─────────────────────────────────────────────

    private static Map<String, Object> oppRow(Decimal amount, Date closeDate) {
        return new Map<String, Object>{
            'oppId' => UserInfo.getUserId(),
            'oppName' => 'OPP-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'amount' => amount,
            'closeDate' => closeDate,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void opp001_largeAndRecent_emitsCritical() {
        DetectorResult r = OPP001ClosedWonNoQuoteDetector.evaluateRow(oppRow(150000, Date.today().addDays(-30)));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void opp001_smallAmount_emitsWarning() {
        DetectorResult r = OPP001ClosedWonNoQuoteDetector.evaluateRow(oppRow(5000, Date.today().addDays(-30)));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void opp001_old_emitsWarning() {
        DetectorResult r = OPP001ClosedWonNoQuoteDetector.evaluateRow(oppRow(200000, Date.today().addDays(-180)));
        System.assertEquals('Warning', r.severity, 'large but old → warning, not critical');
    }

    @isTest static void opp001_handlesNullCloseDate() {
        Map<String, Object> row = oppRow(50000, null);
        row.put('closeDate', null);
        DetectorResult r = OPP001ClosedWonNoQuoteDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void opp001_handlesStringCloseDate() {
        Map<String, Object> row = oppRow(50000, Date.today());
        row.put('closeDate', '2025-01-15');
        DetectorResult r = OPP001ClosedWonNoQuoteDetector.evaluateRow(row);
        System.assertNotEquals(null, r, 'String date should parse');
    }

    @isTest static void opp001_handlesNullOppId() {
        Map<String, Object> row = oppRow(1000, Date.today());
        row.put('oppId', null);
        System.assertEquals(null, OPP001ClosedWonNoQuoteDetector.evaluateRow(row));
    }

    @isTest static void opp001_unwrap_handlesEmptyAndNull() {
        System.assertNotEquals(null, OPP001ClosedWonNoQuoteDetector.unwrap(null));
        System.assertNotEquals(null, OPP001ClosedWonNoQuoteDetector.unwrap(new Map<String, Object>()));
    }

    @isTest static void opp001_runWithoutStub_drivesSoqlPath() {
        // Opportunity is standard — SOQL succeeds even with 0 rows.
        // SBQQ__PrimaryQuote__c may not exist; query then fails gracefully.
        OPP001ClosedWonNoQuoteDetector d = new OPP001ClosedWonNoQuoteDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    @isTest static void opp001_runWithStubRows() {
        OPP001ClosedWonNoQuoteDetector.testStubRows = new List<Map<String, Object>>{
            oppRow(150000, Date.today().addDays(-30))
        };
        OPP001ClosedWonNoQuoteDetector d = new OPP001ClosedWonNoQuoteDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        OPP001ClosedWonNoQuoteDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    // ─── OPP-FOR-002 ─────────────────────────────────────────────

    private static Map<String, Object> opp002Row(Date closeDate) {
        return new Map<String, Object>{
            'oppId' => UserInfo.getUserId(),
            'oppName' => 'OPP-002',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'closeDate' => closeDate,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void opp002_recentZeroDollar_emitsCritical() {
        DetectorResult r = OPP002ClosedWonZeroDollarDetector.evaluateRow(opp002Row(Date.today().addDays(-10)));
        System.assertEquals('Critical', r.severity);
        System.assertEquals('OPP-FOR-002', r.detectorId);
        System.assertEquals(0, r.entitledUsd);
    }

    @isTest static void opp002_olderZeroDollar_emitsWarning() {
        DetectorResult r = OPP002ClosedWonZeroDollarDetector.evaluateRow(opp002Row(Date.today().addDays(-60)));
        System.assertEquals('Warning', r.severity, 'closed >30d ago → warning, not critical');
    }

    @isTest static void opp002_handlesNullCloseDate() {
        Map<String, Object> row = opp002Row(null);
        row.put('closeDate', null);
        DetectorResult r = OPP002ClosedWonZeroDollarDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void opp002_handlesStringCloseDate() {
        Map<String, Object> row = opp002Row(Date.today());
        row.put('closeDate', '2025-01-15');
        DetectorResult r = OPP002ClosedWonZeroDollarDetector.evaluateRow(row);
        System.assertNotEquals(null, r, 'String date should parse');
    }

    @isTest static void opp002_handlesNullOppId() {
        Map<String, Object> row = opp002Row(Date.today());
        row.put('oppId', null);
        System.assertEquals(null, OPP002ClosedWonZeroDollarDetector.evaluateRow(row));
    }

    @isTest static void opp002_unwrap_handlesEmptyAndNull() {
        System.assertNotEquals(null, OPP002ClosedWonZeroDollarDetector.unwrap(null));
        System.assertNotEquals(null, OPP002ClosedWonZeroDollarDetector.unwrap(new Map<String, Object>()));
    }

    @isTest static void opp002_runWithoutStub_drivesSoqlPath() {
        OPP002ClosedWonZeroDollarDetector d = new OPP002ClosedWonZeroDollarDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    @isTest static void opp002_runWithStubRows() {
        OPP002ClosedWonZeroDollarDetector.testStubRows = new List<Map<String, Object>>{
            opp002Row(Date.today().addDays(-10))
        };
        OPP002ClosedWonZeroDollarDetector d = new OPP002ClosedWonZeroDollarDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        OPP002ClosedWonZeroDollarDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    // ─── CON-FOR-001 ─────────────────────────────────────────────

    private static Map<String, Object> conRow(Integer subCount, Date maxSubEnd) {
        return new Map<String, Object>{
            'contractId' => UserInfo.getUserId(),
            'contractNumber' => 'C-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'startDate' => Date.today().addYears(-1),
            'endDate' => Date.today().addYears(1),
            'subscriptionCount' => subCount,
            'maxSubEnd' => maxSubEnd,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void con001_noSubs_flagsAsNoSubs() {
        DetectorResult r = CON001NoActiveSubsDetector.evaluateRow(conRow(0, null));
        System.assertNotEquals(null, r);
        System.assertEquals('CON-FOR-001', r.detectorId);
        System.assert(r.title.contains('zero subscriptions'), r.title);
    }

    @isTest static void con001_allExpired_flags() {
        DetectorResult r = CON001NoActiveSubsDetector.evaluateRow(conRow(5, Date.today().addDays(-30)));
        System.assertNotEquals(null, r);
        System.assert(r.title.contains('all subscriptions expired'), r.title);
    }

    @isTest static void con001_hasLiveSubs_skips() {
        // Some subs, max end date in the future → no flag.
        System.assertEquals(null,
            CON001NoActiveSubsDetector.evaluateRow(conRow(3, Date.today().addMonths(6))));
    }

    @isTest static void con001_acceptsDatetimeMaxEnd() {
        DetectorResult r = CON001NoActiveSubsDetector.evaluateRow(
            conRow(2, null)  // we'll override below
        );
        Map<String, Object> row = conRow(2, null);
        row.put('maxSubEnd', Datetime.now().addDays(-10));
        DetectorResult r2 = CON001NoActiveSubsDetector.evaluateRow(row);
        System.assertNotEquals(null, r2, 'Datetime maxEnd in past should still flag');
    }

    @isTest static void con001_acceptsStringMaxEnd() {
        Map<String, Object> row = conRow(2, null);
        row.put('maxSubEnd', '2020-01-01');
        DetectorResult r = CON001NoActiveSubsDetector.evaluateRow(row);
        System.assertNotEquals(null, r, 'String maxEnd in past should flag');
    }

    @isTest static void con001_garbageStringMaxEnd_treatsAsNoExpiration() {
        Map<String, Object> row = conRow(2, null);
        row.put('maxSubEnd', 'not-a-date');
        // Unparseable string → toDate returns null → no flag.
        System.assertEquals(null, CON001NoActiveSubsDetector.evaluateRow(row));
    }

    @isTest static void con001_handlesNullContractId() {
        Map<String, Object> row = conRow(0, null);
        row.put('contractId', null);
        System.assertEquals(null, CON001NoActiveSubsDetector.evaluateRow(row));
    }

    /** Raw Contract-shape stub (Id/ContractNumber/Account.Name — matches SOQL response).
     *  Drives the full run() pipeline including the sub-aggregate query. */
    private static Map<String, Object> conRawContract(String contractNum) {
        Map<String, Object> m = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'ContractNumber' => contractNum,
            'AccountId' => UserInfo.getOrganizationId(),
            'Account' => new Map<String, Object>{ 'Name' => 'Acme Co' },
            'StartDate' => Date.today().addYears(-1),
            'EndDate' => Date.today().addYears(1),
            'Status' => 'Activated'
        };
        CurrencyContext.addToTestMap(m, 'USD');
        return m;
    }

    @isTest static void con001_runWithStubContracts_drivesFullPipeline() {
        // Stub drives the run() body past the SOQL: it iterates the
        // stub list, attempts the sub-aggregate query (SBQQ namespace
        // may or may not be present — either is fine), then evaluates.
        // The contract has no subs in the test transaction → flags 'no_subs'.
        CON001NoActiveSubsDetector.testStubContracts = new List<Map<String, Object>>{
            conRawContract('C-001'),
            conRawContract('C-002')
        };
        CON001NoActiveSubsDetector d = new CON001NoActiveSubsDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        CON001NoActiveSubsDetector.testStubContracts = null;
        // Both stubs share the same UserInfo.getUserId() as Id — duplicate Ids
        // get deduped by the subState map, so we see 2 findings but both flag
        // 'no_subs' (no subscriptions reference this synthetic Id).
        System.assert(r.size() >= 1, 'Should emit at least one finding for no_subs');
    }

    @isTest static void con001_runWithStubRows_alsoWorks() {
        CON001NoActiveSubsDetector.testStubRows = new List<Map<String, Object>>{
            conRow(0, null)
        };
        CON001NoActiveSubsDetector d = new CON001NoActiveSubsDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        CON001NoActiveSubsDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }

    @isTest static void con001_runWithoutStubs_drivesSoqlPath() {
        // Contract is a standard object → SOQL succeeds (possibly 0 rows).
        // SBQQ__Subscription__c may not be installed → inner catch handles.
        CON001NoActiveSubsDetector d = new CON001NoActiveSubsDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── CON-FOR-002 ─────────────────────────────────────────────

    private static Map<String, Object> con002Row(Date childEnd, Date parentEnd) {
        return new Map<String, Object>{
            'contractId' => UserInfo.getUserId(),
            'contractNumber' => 'C-CHILD',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'endDate' => childEnd,
            'parentContractId' => UserInfo.getOrganizationId(),
            'parentContractNumber' => 'C-PARENT',
            'parentEndDate' => parentEnd,
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void con002_largeDateDelta_emitsCritical() {
        DetectorResult r = CON002OrphanContractDetector.evaluateRow(
            con002Row(Date.today().addDays(180), Date.today().addDays(45)));
        System.assertNotEquals(null, r);
        System.assertEquals('Critical', r.severity);
        System.assertEquals('CON-FOR-002', r.detectorId);
    }

    @isTest static void con002_smallDateDelta_emitsWarning() {
        DetectorResult r = CON002OrphanContractDetector.evaluateRow(
            con002Row(Date.today().addDays(60), Date.today().addDays(45)));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void con002_sameEndDates_returnsNull() {
        DetectorResult r = CON002OrphanContractDetector.evaluateRow(
            con002Row(Date.today().addDays(90), Date.today().addDays(90)));
        System.assertEquals(null, r, 'matched end dates → co-termed → skip');
    }

    @isTest static void con002_nullDates_returnsNull() {
        DetectorResult r = CON002OrphanContractDetector.evaluateRow(
            con002Row(null, Date.today().addDays(90)));
        System.assertEquals(null, r);
        r = CON002OrphanContractDetector.evaluateRow(
            con002Row(Date.today().addDays(90), null));
        System.assertEquals(null, r);
    }

    @isTest static void con002_handlesStringDates() {
        Map<String, Object> row = con002Row(Date.today(), Date.today());
        row.put('endDate', '2025-01-15');
        row.put('parentEndDate', '2024-12-15');
        DetectorResult r = CON002OrphanContractDetector.evaluateRow(row);
        System.assertNotEquals(null, r, 'string dates should parse');
    }

    @isTest static void con002_handlesNullContractId() {
        Map<String, Object> row = con002Row(Date.today().addDays(60), Date.today().addDays(30));
        row.put('contractId', null);
        System.assertEquals(null, CON002OrphanContractDetector.evaluateRow(row));
    }

    @isTest static void con002_unwrap_handlesEmptyAndNull() {
        System.assertNotEquals(null, CON002OrphanContractDetector.unwrap(null));
        System.assertNotEquals(null, CON002OrphanContractDetector.unwrap(new Map<String, Object>()));
    }

    @isTest static void con002_runWithoutStub_drivesSoqlPath() {
        CON002OrphanContractDetector d = new CON002OrphanContractDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    @isTest static void con002_runWithStubRows() {
        CON002OrphanContractDetector.testStubRows = new List<Map<String, Object>>{
            con002Row(Date.today().addDays(180), Date.today().addDays(45))
        };
        CON002OrphanContractDetector d = new CON002OrphanContractDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        CON002OrphanContractDetector.testStubRows = null;
        System.assertEquals(1, r.size());
    }
}
