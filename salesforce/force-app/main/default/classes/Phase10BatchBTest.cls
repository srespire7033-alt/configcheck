/**
 * Phase 10 Batch B — tests for REN-003, REN-004 (renewal pipeline).
 * Pure map fixtures, no CPQ namespace compile-time dependency.
 */
@isTest
private class Phase10BatchBTest {

    // ─── REN-003: Quote expired with no renewal ──────────────────────

    private static Map<String, Object> ren003Row(Integer daysSinceExpiration, Decimal arrAtRisk) {
        return new Map<String, Object>{
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'Q-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'arrAtRisk' => arrAtRisk,
            'expirationDate' => Date.today().addDays(-daysSinceExpiration),
            'quoteType' => 'Quote',
            'quoteStatus' => 'Approved',
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ren003_recent_small_emitsInfo() {
        DetectorResult r = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(ren003Row(15, 5000));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void ren003_medium_window_emitsWarning() {
        DetectorResult r = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(ren003Row(45, 20000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ren003_late_or_large_emitsCritical() {
        DetectorResult r = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(ren003Row(75, 5000));
        System.assertEquals('Critical', r.severity, '>60d → critical regardless of $');
        DetectorResult r2 = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(ren003Row(20, 200000));
        System.assertEquals('Critical', r2.severity, '>=100k → critical regardless of days');
    }

    @isTest static void ren003_handlesNullQuoteId() {
        Map<String, Object> row = ren003Row(30, 1000);
        row.put('quoteId', null);
        System.assertEquals(null, REN003ExpiredQuoteNoRenewalDetector.evaluateRow(row));
    }

    @isTest static void ren003_handlesNullExpirationDate() {
        Map<String, Object> row = ren003Row(30, 1000);
        row.put('expirationDate', null);
        System.assertEquals(null, REN003ExpiredQuoteNoRenewalDetector.evaluateRow(row));
    }

    @isTest static void ren003_handlesStringExpirationDate() {
        Map<String, Object> row = ren003Row(30, 5000);
        row.put('expirationDate', String.valueOf(Date.today().addDays(-30)));
        DetectorResult r = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ren003_handlesDatetimeExpirationDate() {
        Map<String, Object> row = ren003Row(30, 5000);
        row.put('expirationDate', Datetime.now().addDays(-30));
        DetectorResult r = REN003ExpiredQuoteNoRenewalDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ren003_garbageDateString_skips() {
        Map<String, Object> row = ren003Row(30, 5000);
        row.put('expirationDate', 'not-a-date');
        System.assertEquals(null, REN003ExpiredQuoteNoRenewalDetector.evaluateRow(row));
    }

    @isTest static void ren003_runWithStubRows_emits() {
        REN003ExpiredQuoteNoRenewalDetector.testStubRows = new List<Map<String, Object>>{
            ren003Row(15, 5000),
            ren003Row(75, 50000),
            ren003Row(45, 200000)
        };
        REN003ExpiredQuoteNoRenewalDetector d = new REN003ExpiredQuoteNoRenewalDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        REN003ExpiredQuoteNoRenewalDetector.testStubRows = null;
        System.assertEquals(3, r.size());
    }

    @isTest static void ren003_runWithStubExpiredQuotes_drivesFullPipeline() {
        // Drive the full run() including the renewals-by-account lookup.
        // Stub expired quotes with raw Salesforce-shape keys.
        Id acctId = UserInfo.getOrganizationId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'Q-001',
            'SBQQ__Account__c' => acctId,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__EndDate__c' => Date.today().addDays(-45),
            'SBQQ__NetAmount__c' => 50000,
            'SBQQ__Type__c' => 'Quote',
            'SBQQ__Status__c' => 'Approved'
        };
        CurrencyContext.addToTestMap(q, 'USD');
        REN003ExpiredQuoteNoRenewalDetector.testStubExpiredQuotes = new List<Map<String, Object>>{ q };
        // No renewal exists for this account → flag should fire.
        REN003ExpiredQuoteNoRenewalDetector.testStubRenewalsByAccount = new Map<Id, Object>();
        REN003ExpiredQuoteNoRenewalDetector d = new REN003ExpiredQuoteNoRenewalDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        REN003ExpiredQuoteNoRenewalDetector.testStubExpiredQuotes = null;
        REN003ExpiredQuoteNoRenewalDetector.testStubRenewalsByAccount = null;
        System.assertEquals(1, r.size(), 'Expired quote with no renewal → 1 finding');
    }

    @isTest static void ren003_renewalAfterExpiration_skips() {
        // Quote expired 45d ago; renewal opened 10d ago → no flag.
        Id acctId = UserInfo.getOrganizationId();
        Map<String, Object> q = new Map<String, Object>{
            'Id' => UserInfo.getUserId(),
            'Name' => 'Q-001',
            'SBQQ__Account__c' => acctId,
            'SBQQ__Account__r' => new Map<String, Object>{ 'Name' => 'Acme' },
            'SBQQ__EndDate__c' => Date.today().addDays(-45),
            'SBQQ__NetAmount__c' => 50000,
            'SBQQ__Type__c' => 'Quote'
        };
        CurrencyContext.addToTestMap(q, 'USD');
        REN003ExpiredQuoteNoRenewalDetector.testStubExpiredQuotes = new List<Map<String, Object>>{ q };
        REN003ExpiredQuoteNoRenewalDetector.testStubRenewalsByAccount = new Map<Id, Object>{
            acctId => Date.today().addDays(-10)
        };
        REN003ExpiredQuoteNoRenewalDetector d = new REN003ExpiredQuoteNoRenewalDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        REN003ExpiredQuoteNoRenewalDetector.testStubExpiredQuotes = null;
        REN003ExpiredQuoteNoRenewalDetector.testStubRenewalsByAccount = null;
        System.assertEquals(0, r.size(), 'Renewal exists → no flag');
    }

    @isTest static void ren003_runWithoutStubs_drivesSoqlPath() {
        REN003ExpiredQuoteNoRenewalDetector d = new REN003ExpiredQuoteNoRenewalDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }

    // ─── REN-004: Renewal Quote stuck in Draft ──────────────────────

    private static Map<String, Object> ren004Row(Integer daysOverdue, Decimal arrAtRisk) {
        return new Map<String, Object>{
            'quoteId' => UserInfo.getUserId(),
            'quoteName' => 'RQ-001',
            'accountId' => UserInfo.getOrganizationId(),
            'accountName' => 'Acme Co',
            'status' => 'Draft',
            'arrAtRisk' => arrAtRisk,
            'contractId' => UserInfo.getUserId(),
            'contractEndDate' => Date.today().addDays(-daysOverdue),
            'contractNumber' => 'C-001',
            'lastModifiedDate' => Date.today().addDays(-daysOverdue + 5),
            'currencyIsoCode' => 'USD'
        };
    }

    @isTest static void ren004_recent_emitsInfo() {
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(ren004Row(15, 5000));
        System.assertEquals('Info', r.severity);
    }

    @isTest static void ren004_medium_emitsWarning() {
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(ren004Row(45, 20000));
        System.assertEquals('Warning', r.severity);
    }

    @isTest static void ren004_late_emitsCritical() {
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(ren004Row(120, 5000));
        System.assertEquals('Critical', r.severity);
    }

    @isTest static void ren004_handlesNullQuoteId() {
        Map<String, Object> row = ren004Row(30, 1000);
        row.put('quoteId', null);
        System.assertEquals(null, REN004StuckDraftRenewalDetector.evaluateRow(row));
    }

    @isTest static void ren004_handlesNullContractEnd() {
        Map<String, Object> row = ren004Row(30, 1000);
        row.put('contractEndDate', null);
        System.assertEquals(null, REN004StuckDraftRenewalDetector.evaluateRow(row));
    }

    @isTest static void ren004_futureContractEnd_skips() {
        Map<String, Object> row = ren004Row(0, 1000);
        row.put('contractEndDate', Date.today().addDays(30));
        System.assertEquals(null, REN004StuckDraftRenewalDetector.evaluateRow(row),
            'Contract still live → not stuck');
    }

    @isTest static void ren004_handlesStringContractEnd() {
        Map<String, Object> row = ren004Row(30, 5000);
        row.put('contractEndDate', String.valueOf(Date.today().addDays(-30)));
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ren004_handlesDatetimeContractEnd() {
        Map<String, Object> row = ren004Row(30, 5000);
        row.put('contractEndDate', Datetime.now().addDays(-30));
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
    }

    @isTest static void ren004_handlesMissingAccountName() {
        Map<String, Object> row = ren004Row(30, 5000);
        row.remove('accountName');
        DetectorResult r = REN004StuckDraftRenewalDetector.evaluateRow(row);
        System.assertNotEquals(null, r);
        System.assert(r.description.contains('Account '));
    }

    @isTest static void ren004_unwrap_handlesEmptyAndNull() {
        System.assertNotEquals(null, REN004StuckDraftRenewalDetector.unwrap(null));
        System.assertNotEquals(null, REN004StuckDraftRenewalDetector.unwrap(new Map<String, Object>()));
    }

    @isTest static void ren004_runWithStubRows_iterates() {
        REN004StuckDraftRenewalDetector.testStubRows = new List<Map<String, Object>>{
            ren004Row(45, 30000),
            ren004Row(120, 200000)
        };
        REN004StuckDraftRenewalDetector d = new REN004StuckDraftRenewalDetector();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        REN004StuckDraftRenewalDetector.testStubRows = null;
        System.assertEquals(2, r.size());
    }

    @isTest static void ren004_runWithoutStubs_drivesSoqlPath() {
        REN004StuckDraftRenewalDetector d = new REN004StuckDraftRenewalDetector();
        Test.startTest();
        List<DetectorResult> r = d.run(new DetectorContext(null, 'USD', 'CPQ'));
        Test.stopTest();
        System.assert(r != null);
    }
}
