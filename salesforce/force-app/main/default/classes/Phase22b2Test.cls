/**
 * Phase 22b-2 — Tests for FB/GL/LE/RR/TR bundles (24 checks).
 * No live blng__ surface on Techtorch — tests use testStub paths
 * and also exercise the surface-gate skip path via run().
 */
@IsTest
private class Phase22b2Test {

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id bkId() { return mkId('a0b'); }
    private static Id pdId() { return mkId('a0p'); }
    private static Id ruleId() { return mkId('a0r'); }
    private static Id trtId() { return mkId('a0t'); }
    private static Id leId() { return mkId('a0l'); }
    private static Id rrId() { return mkId('a0v'); }
    private static Id taxId() { return mkId('a0x'); }
    private static Id prodId() { return mkId('01t'); }
    private static Id glaId() { return mkId('a0a'); }

    private static DetectorContext ctx() {
        return new DetectorContext(null, 'USD', 'CPQ+Billing');
    }

    // ── Finance Books ──────────────────────────────────────────────

    private static Map<String, Object> book(String name, Boolean active, List<Map<String, Object>> periods) {
        Map<String, Object> b = new Map<String, Object>{
            'Id' => bkId(), 'Name' => name, 'blng__Active__c' => active
        };
        if (periods != null) {
            b.put('blng__FinancePeriods__r',
                new Map<String, Object>{ 'records' => (Object) periods });
        }
        return b;
    }
    private static Map<String, Object> period(Id bookId, String status, Date sd, Date ed) {
        return new Map<String, Object>{
            'Id' => pdId(), 'Name' => 'Per', 'blng__FinanceBook__c' => bookId,
            'blng__PeriodStatus__c' => status,
            'blng__PeriodStartDate__c' => sd,
            'blng__PeriodEndDate__c' => ed
        };
    }

    @IsTest static void fb001_flags_book_with_no_open_current_period() {
        Id bid = bkId();
        Map<String, Object> openOld = period(bid, 'Open', Date.today().addYears(-2), Date.today().addYears(-2).addMonths(1));
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => bid, 'Name' => 'Book', 'blng__Active__c' => true,
                'blng__FinancePeriods__r' => new Map<String, Object>{
                    'records' => (Object) new List<Map<String, Object>>{ openOld }
                }
            }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>{ openOld };
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean fb001 = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-001') fb001 = true;
        System.assert(fb001, 'FB-001 should fire');
    }

    @IsTest static void fb001_skips_book_with_no_periods() {
        Id bid = bkId();
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => bid, 'Name' => 'Empty', 'blng__Active__c' => true,
                'blng__FinancePeriods__r' => new Map<String, Object>{
                    'records' => (Object) new List<Map<String, Object>>()
                }
            }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>();
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        for (DetectorResult dr : r) System.assertNotEquals('FB-001', dr.detectorId);
    }

    @IsTest static void fb002_flags_period_gap() {
        Id bid = bkId();
        Map<String, Object> p1 = period(bid, 'Open', Date.newInstance(2024,1,1), Date.newInstance(2024,1,31));
        Map<String, Object> p2 = period(bid, 'Open', Date.newInstance(2024,3,15), Date.newInstance(2024,3,31));
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => bid, 'Name' => 'B', 'blng__Active__c' => true }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>{ p1, p2 };
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean fb002 = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-002') fb002 = true;
        System.assert(fb002, 'FB-002 should fire');
    }

    @IsTest static void fb003_flags_overlap() {
        Id bid = bkId();
        Map<String, Object> p1 = period(bid, 'Open', Date.newInstance(2024,1,1), Date.newInstance(2024,2,15));
        Map<String, Object> p2 = period(bid, 'Open', Date.newInstance(2024,2,1), Date.newInstance(2024,2,28));
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => bid, 'Name' => 'B', 'blng__Active__c' => true }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>{ p1, p2 };
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean fb003 = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-003') fb003 = true;
        System.assert(fb003, 'FB-003 should fire');
    }

    @IsTest static void fb004_flags_book_with_no_periods() {
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => bkId(), 'Name' => 'B', 'blng__Active__c' => true }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>();
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-004') ok = true;
        System.assert(ok, 'FB-004 should fire');
    }

    @IsTest static void fb005_flags_old_open_period() {
        Map<String, Object> oldp = period(bkId(), 'Open',
            Date.newInstance(2020,1,1), Date.newInstance(2020,1,31));
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>();
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>{ oldp };
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-005') ok = true;
        System.assert(ok, 'FB-005 should fire');
    }

    @IsTest static void fb006_no_books_at_all() {
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>();
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>();
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-006') ok = true;
        System.assert(ok, 'FB-006 should fire');
    }

    @IsTest static void fb006_all_books_inactive() {
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => bkId(), 'Name' => 'B', 'blng__Active__c' => false }
        };
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>();
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-006') ok = true;
        System.assert(ok, 'FB-006 inactive branch should fire');
    }

    @IsTest static void fb007_past_open_period() {
        Map<String, Object> past = period(bkId(), 'Open',
            Date.today().addMonths(-3), Date.today().addMonths(-1));
        FinanceBookChecksBundle.testStubBooks = new List<Map<String, Object>>();
        FinanceBookChecksBundle.testStubPeriods = new List<Map<String, Object>>{ past };
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'FB-007') ok = true;
        System.assert(ok, 'FB-007 should fire');
    }

    @IsTest static void fb_remote_path_swallows_missing_surface() {
        // Local-context (no remote) without stubs — surface gate exits clean.
        FinanceBookChecksBundle.testStubBooks = null;
        FinanceBookChecksBundle.testStubPeriods = null;
        List<DetectorResult> r = new FinanceBookChecksBundle().run(ctx());
        System.assertEquals(0, r.size());
    }

    // ── GL Rules ───────────────────────────────────────────────────

    @IsTest static void gl_all_checks() {
        Id activeRuleId = ruleId();
        Id inactiveRuleId = ruleId();
        Map<String, Object> aRule = new Map<String, Object>{
            'Id' => activeRuleId, 'Name' => 'AR', 'blng__Active__c' => true
        };
        Map<String, Object> iRule = new Map<String, Object>{
            'Id' => inactiveRuleId, 'Name' => 'IR', 'blng__Active__c' => false
        };
        // GL-001: active treatment with no accounts
        Map<String, Object> t1 = new Map<String, Object>{
            'Id' => trtId(), 'Name' => 'T1', 'blng__Active__c' => true,
            'blng__GLRule__c' => activeRuleId,
            'blng__CreditGLAccount__c' => null, 'blng__DebitGLAccount__c' => null
        };
        // GL-003: inactive treatment on active rule
        Map<String, Object> t2 = new Map<String, Object>{
            'Id' => trtId(), 'Name' => 'T2', 'blng__Active__c' => false,
            'blng__GLRule__c' => activeRuleId,
            'blng__CreditGLAccount__c' => glaId(), 'blng__DebitGLAccount__c' => glaId()
        };
        // GL-004: only one side
        Map<String, Object> t3 = new Map<String, Object>{
            'Id' => trtId(), 'Name' => 'T3', 'blng__Active__c' => true,
            'blng__GLRule__c' => activeRuleId,
            'blng__CreditGLAccount__c' => glaId(), 'blng__DebitGLAccount__c' => null
        };
        // GL-002 fires because no treatment of inactiveRule exists, but it's inactive
        // need an ACTIVE rule with no treatments — make another active rule with no children
        Id ruleNoChildren = ruleId();
        Map<String, Object> aRuleNo = new Map<String, Object>{
            'Id' => ruleNoChildren, 'Name' => 'AR2', 'blng__Active__c' => true
        };

        GlRuleChecksBundle.testStubRules = new List<Map<String, Object>>{ aRule, iRule, aRuleNo };
        GlRuleChecksBundle.testStubTreatments = new List<Map<String, Object>>{ t1, t2, t3 };
        List<DetectorResult> r = new GlRuleChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        // Phase 24f — GL-001 migrated to CustomDetector__mdt. Bundle no
        // longer dispatches it.
        System.assert(!fired.contains('GL-001'), 'GL-001 migrated to CustomDetector__mdt');
        System.assert(fired.contains('GL-002'), 'GL-002');
        System.assert(fired.contains('GL-003'), 'GL-003');
        System.assert(fired.contains('GL-004'), 'GL-004');
        System.assert(fired.contains('GL-005'), 'GL-005');
    }

    @IsTest static void gl_remote_gate_exits_clean() {
        GlRuleChecksBundle.testStubRules = null;
        GlRuleChecksBundle.testStubTreatments = null;
        List<DetectorResult> r = new GlRuleChecksBundle().run(ctx());
        System.assertEquals(0, r.size());
    }

    // ── Legal Entity ───────────────────────────────────────────────

    @IsTest static void le001_no_entities() {
        LegalEntityChecksBundle.testStubRows = new List<Map<String, Object>>();
        List<DetectorResult> r = new LegalEntityChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'LE-001') ok = true;
        System.assert(ok);
    }

    @IsTest static void le002_missing_address() {
        LegalEntityChecksBundle.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => leId(), 'Name' => 'LE', 'blng__Active__c' => true,
                'blng__Street__c' => null, 'blng__City__c' => 'NYC', 'blng__Country__c' => 'US'
            }
        };
        List<DetectorResult> r = new LegalEntityChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'LE-002') ok = true;
        System.assert(ok);
    }

    @IsTest static void le003_all_inactive() {
        LegalEntityChecksBundle.testStubRows = new List<Map<String, Object>>{
            new Map<String, Object>{
                'Id' => leId(), 'Name' => 'LE', 'blng__Active__c' => false,
                'blng__Street__c' => 'St', 'blng__City__c' => 'C', 'blng__Country__c' => 'US'
            }
        };
        List<DetectorResult> r = new LegalEntityChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'LE-003') ok = true;
        System.assert(ok);
    }

    @IsTest static void le004_multiple_active() {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Integer i = 0; i < 3; i++) {
            rows.add(new Map<String, Object>{
                'Id' => leId(), 'Name' => 'LE' + i, 'blng__Active__c' => true,
                'blng__Street__c' => 'St', 'blng__City__c' => 'C', 'blng__Country__c' => 'US'
            });
        }
        LegalEntityChecksBundle.testStubRows = rows;
        List<DetectorResult> r = new LegalEntityChecksBundle().run(ctx());
        Boolean ok = false;
        for (DetectorResult dr : r) if (dr.detectorId == 'LE-004') ok = true;
        System.assert(ok);
    }

    @IsTest static void le_remote_gate_exits_clean() {
        LegalEntityChecksBundle.testStubRows = null;
        List<DetectorResult> r = new LegalEntityChecksBundle().run(ctx());
        System.assertEquals(0, r.size());
    }

    // ── Rev Rec ────────────────────────────────────────────────────

    @IsTest static void rr_all_checks() {
        Id activeRule = rrId();
        Id inactiveRule = rrId();
        Map<String, Object> aR = new Map<String, Object>{
            'Id' => activeRule, 'Name' => 'AR', 'blng__Active__c' => true,
            'blng__CreateRevenueSchedule__c' => null
        };
        Map<String, Object> iR = new Map<String, Object>{
            'Id' => inactiveRule, 'Name' => 'IR', 'blng__Active__c' => false,
            'blng__CreateRevenueSchedule__c' => 'Yes'
        };
        Map<String, Object> noR = new Map<String, Object>{
            'Id' => rrId(), 'Name' => 'NoR', 'blng__Active__c' => true,
            'blng__CreateRevenueSchedule__c' => 'No'
        };
        Map<String, Object> orphan = new Map<String, Object>{
            'Id' => rrId(), 'Name' => 'Orphan', 'blng__Active__c' => true,
            'blng__CreateRevenueSchedule__c' => 'Yes'
        };
        // Product referencing inactive rule → RR-001
        Map<String, Object> p1 = new Map<String, Object>{
            'Id' => prodId(), 'Name' => 'P1', 'IsActive' => true,
            'blng__RevenueRecognitionRule__c' => inactiveRule
        };
        // Product referencing active rule (so aR is not orphan)
        Map<String, Object> p2 = new Map<String, Object>{
            'Id' => prodId(), 'Name' => 'P2', 'IsActive' => true,
            'blng__RevenueRecognitionRule__c' => activeRule
        };
        RevRecRuleChecksBundle.testStubRules = new List<Map<String, Object>>{ aR, iR, noR, orphan };
        RevRecRuleChecksBundle.testStubProducts = new List<Map<String, Object>>{ p1, p2 };
        List<DetectorResult> r = new RevRecRuleChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('RR-001'), 'RR-001');
        System.assert(fired.contains('RR-002'), 'RR-002');
        System.assert(fired.contains('RR-003'), 'RR-003');
        System.assert(fired.contains('RR-004'), 'RR-004');
    }

    @IsTest static void rr_remote_gate_exits_clean() {
        RevRecRuleChecksBundle.testStubRules = null;
        RevRecRuleChecksBundle.testStubProducts = null;
        List<DetectorResult> r = new RevRecRuleChecksBundle().run(ctx());
        System.assertEquals(0, r.size());
    }

    // ── Tax ────────────────────────────────────────────────────────

    @IsTest static void tr_all_checks() {
        Id activeRule = taxId();
        Id inactiveRule = taxId();
        Map<String, Object> aR = new Map<String, Object>{
            'Id' => activeRule, 'Name' => 'AR', 'blng__Active__c' => true,
            'blng__TaxableYesNo__c' => 'No'  // TR-003 fires
        };
        Map<String, Object> iR = new Map<String, Object>{
            'Id' => inactiveRule, 'Name' => 'IR', 'blng__Active__c' => false,
            'blng__TaxableYesNo__c' => 'Yes'  // TR-004 fires
        };
        Map<String, Object> pNo = new Map<String, Object>{
            'Id' => prodId(), 'Name' => 'PNo', 'blng__TaxRule__c' => null
        };
        Map<String, Object> pInactive = new Map<String, Object>{
            'Id' => prodId(), 'Name' => 'PInact', 'blng__TaxRule__c' => inactiveRule
        };
        TaxRuleChecksBundle.testStubRules = new List<Map<String, Object>>{ aR, iR };
        TaxRuleChecksBundle.testStubProductsAll = new List<Map<String, Object>>{ pNo, pInactive };
        TaxRuleChecksBundle.testStubProductsRefs = new List<Map<String, Object>>{ pInactive };
        List<DetectorResult> r = new TaxRuleChecksBundle().run(ctx());
        Set<String> fired = new Set<String>();
        for (DetectorResult dr : r) fired.add(dr.detectorId);
        System.assert(fired.contains('TR-001'), 'TR-001');
        System.assert(fired.contains('TR-002'), 'TR-002');
        System.assert(fired.contains('TR-003'), 'TR-003');
        System.assert(fired.contains('TR-004'), 'TR-004');
    }

    @IsTest static void tr_remote_gate_exits_clean() {
        TaxRuleChecksBundle.testStubRules = null;
        TaxRuleChecksBundle.testStubProductsAll = null;
        TaxRuleChecksBundle.testStubProductsRefs = null;
        List<DetectorResult> r = new TaxRuleChecksBundle().run(ctx());
        System.assertEquals(0, r.size());
    }

    // ── Direct calls on data-fetch helpers (coverage on Techtorch) ──

    @IsTest static void direct_helper_calls_for_coverage() {
        // Exercise the @TestVisible evaluate helpers on empty inputs.
        System.assertEquals(0,
            FinanceBookChecksBundle.evaluateFB004(new List<Map<String, Object>>(), new List<Map<String, Object>>()).size());
        System.assertEquals(0,
            FinanceBookChecksBundle.evaluateFB005(new List<Map<String, Object>>()).size());
        System.assertEquals(1,
            FinanceBookChecksBundle.evaluateFB006(new List<Map<String, Object>>()).size());
        System.assertEquals(0,
            GlRuleChecksBundle.evaluateGL001(new List<Map<String, Object>>()).size());
        System.assertEquals(0,
            GlRuleChecksBundle.evaluateGL005(new List<Map<String, Object>>()).size());
        System.assertEquals(1,
            LegalEntityChecksBundle.evaluateLE001(new List<Map<String, Object>>()).size());
        System.assertEquals(0,
            RevRecRuleChecksBundle.evaluateRR002(new List<Map<String, Object>>()).size());
        System.assertEquals(0,
            TaxRuleChecksBundle.evaluateTR003(new List<Map<String, Object>>()).size());
    }
}
