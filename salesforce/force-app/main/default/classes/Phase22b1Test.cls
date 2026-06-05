/**
 * Phase 22b-1 — Tests for BillingRuleBundle (10 checks) +
 * InvoicingChecksBundle (5 checks).
 *
 * No live blng__ object on Techtorch, so all tests run via testStub
 * paths that bypass the SchemaUtil gate.
 */
@IsTest
private class Phase22b1Test {

    // ── helpers ────────────────────────────────────────────────────

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id pid() { return mkId('01t'); }
    private static Id rid() { return mkId('a0r'); }
    private static Id invId() { return mkId('a0i'); }
    private static Id cnId() { return mkId('a0c'); }
    private static Id gltId() { return mkId('a0g'); }

    private static Map<String, Object> rel(Boolean active) {
        return new Map<String, Object>{ 'blng__Active__c' => active };
    }
    private static Map<String, Object> product(Boolean active, Id billingRule,
            Id revRecRule, Id taxRule, String chargeType, String billFreq) {
        return new Map<String, Object>{
            'Id' => pid(), 'Name' => 'P', 'IsActive' => active,
            'blng__BillingRule__c' => billingRule,
            'blng__RevenueRecognitionRule__c' => revRecRule,
            'blng__TaxRule__c' => taxRule,
            'SBQQ__ChargeType__c' => chargeType,
            'SBQQ__BillingFrequency__c' => billFreq
        };
    }
    private static Map<String, Object> rule(String name, Boolean active) {
        return new Map<String, Object>{
            'Id' => rid(), 'Name' => name, 'blng__Active__c' => active
        };
    }

    // ── BR-001 ────────────────────────────────────────────────────

    @IsTest
    static void br001_flags_active_product_with_inactive_rule() {
        Map<String, Object> r = rule('R1', false);
        Id rId = (Id) r.get('Id');
        Map<String, Object> p = product(true, rId, null, null, null, null);
        List<DetectorResult> out = BillingRuleBundle.evaluateBR001(
            new List<Map<String, Object>>{ p }, new List<Map<String, Object>>{ r });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void br001_no_fire_when_rule_active() {
        Map<String, Object> r = rule('R1', true);
        Map<String, Object> p = product(true, (Id) r.get('Id'), null, null, null, null);
        System.assertEquals(0, BillingRuleBundle.evaluateBR001(
            new List<Map<String, Object>>{ p }, new List<Map<String, Object>>{ r }).size());
    }

    @IsTest
    static void br001_includes_null_active_as_inactive() {
        // !r.blng__Active__c is true for both false AND null per TS.
        Map<String, Object> r = rule('R1', null);
        Map<String, Object> p = product(true, (Id) r.get('Id'), null, null, null, null);
        System.assertEquals(1, BillingRuleBundle.evaluateBR001(
            new List<Map<String, Object>>{ p }, new List<Map<String, Object>>{ r }).size());
    }

    // ── BR-002 ────────────────────────────────────────────────────

    @IsTest
    static void br002_flags_active_rule_without_treatment() {
        Map<String, Object> r = rule('R1', true);
        // No GL treatment refs this rule.
        List<DetectorResult> out = BillingRuleBundle.evaluateBR002(
            new List<Map<String, Object>>{ r }, new List<Map<String, Object>>());
        System.assertEquals(1, out.size());
    }

    @IsTest
    static void br002_no_fire_when_treatment_exists() {
        Map<String, Object> r = rule('R1', true);
        Map<String, Object> t = new Map<String, Object>{
            'Id' => gltId(), 'blng__GLRule__c' => (Id) r.get('Id')
        };
        System.assertEquals(0, BillingRuleBundle.evaluateBR002(
            new List<Map<String, Object>>{ r }, new List<Map<String, Object>>{ t }).size());
    }

    // ── BR-003 ────────────────────────────────────────────────────

    @IsTest
    static void br003_flags_orphan_rule() {
        Map<String, Object> r = rule('R1', true);
        // No product references this rule.
        System.assertEquals(1, BillingRuleBundle.evaluateBR003(
            new List<Map<String, Object>>(), new List<Map<String, Object>>{ r }).size());
    }

    @IsTest
    static void br003_no_fire_when_rule_used() {
        Map<String, Object> r = rule('R1', true);
        Map<String, Object> p = product(true, (Id) r.get('Id'), null, null, null, null);
        System.assertEquals(0, BillingRuleBundle.evaluateBR003(
            new List<Map<String, Object>>{ p }, new List<Map<String, Object>>{ r }).size());
    }

    // ── BR-004 ────────────────────────────────────────────────────

    @IsTest
    static void br004_flags_duplicate_names() {
        Map<String, Object> r1 = rule('SameName', true);
        Map<String, Object> r2 = rule('SameName', true);
        System.assertEquals(1, BillingRuleBundle.evaluateBR004(
            new List<Map<String, Object>>{ r1, r2 }).size());
    }

    @IsTest
    static void br004_no_fire_when_names_unique() {
        Map<String, Object> r1 = rule('A', true);
        Map<String, Object> r2 = rule('B', true);
        System.assertEquals(0, BillingRuleBundle.evaluateBR004(
            new List<Map<String, Object>>{ r1, r2 }).size());
    }

    // ── PBC-001..005 ──────────────────────────────────────────────

    @IsTest
    static void pbc001_flags_product_without_billing_rule() {
        Map<String, Object> p = product(true, null, rid(), rid(), 'One-Time', null);
        System.assertEquals(1, BillingRuleBundle.evaluatePBC001(
            new List<Map<String, Object>>{ p }).size());
    }

    @IsTest
    static void pbc004_flags_product_without_charge_type() {
        Map<String, Object> p = product(true, rid(), rid(), rid(), null, null);
        System.assertEquals(1, BillingRuleBundle.evaluatePBC004(
            new List<Map<String, Object>>{ p }).size());
    }

    @IsTest
    static void pbc005_flags_recurring_without_frequency() {
        Map<String, Object> p = product(true, rid(), rid(), rid(), 'Recurring', null);
        System.assertEquals(1, BillingRuleBundle.evaluatePBC005(
            new List<Map<String, Object>>{ p }).size());
    }

    @IsTest
    static void pbc005_no_fire_for_one_time_products() {
        Map<String, Object> p = product(true, rid(), rid(), rid(), 'One-Time', null);
        System.assertEquals(0, BillingRuleBundle.evaluatePBC005(
            new List<Map<String, Object>>{ p }).size());
    }

    // ── PBC-006: strict-false semantics ───────────────────────────

    @IsTest
    static void pbc006_fires_only_when_related_active_strictly_false() {
        Id rId = rid();
        Map<String, Object> p = product(true, rId, null, null, null, null);
        // blng__BillingRule__r populated, blng__Active__c explicitly false.
        p.put('blng__BillingRule__r', rel(false));
        System.assertEquals(1, BillingRuleBundle.evaluatePBC006(
            new List<Map<String, Object>>{ p }).size());
    }

    @IsTest
    static void pbc006_no_fire_when_related_active_null() {
        Id rId = rid();
        Map<String, Object> p = product(true, rId, null, null, null, null);
        p.put('blng__BillingRule__r', rel(null));
        System.assertEquals(0, BillingRuleBundle.evaluatePBC006(
            new List<Map<String, Object>>{ p }).size(), 'null Active != false');
    }

    @IsTest
    static void pbc006_no_fire_when_relationship_null() {
        // Rule unset entirely.
        Map<String, Object> p = product(true, null, null, null, null, null);
        System.assertEquals(0, BillingRuleBundle.evaluatePBC006(
            new List<Map<String, Object>>{ p }).size());
    }

    // ── INV-001 ────────────────────────────────────────────────────

    @IsTest
    static void inv001_flags_old_drafts() {
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Draft',
            'CreatedDate' => System.now().addDays(-60),
            'blng__TotalAmount__c' => 1000
        };
        List<DetectorResult> out = InvoicingChecksBundle.evaluateINV001(
            new List<Map<String, Object>>{ i });
        System.assertEquals(1, out.size());
        System.assertEquals(1000, out[0].gapUsd);
    }

    @IsTest
    static void inv001_no_fire_for_recent_drafts() {
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Draft',
            'CreatedDate' => System.now().addDays(-15)
        };
        System.assertEquals(0, InvoicingChecksBundle.evaluateINV001(
            new List<Map<String, Object>>{ i }).size());
    }

    // ── INV-002 ────────────────────────────────────────────────────

    @IsTest
    static void inv002_flags_strict_zero_posted() {
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Posted',
            'blng__TotalAmount__c' => 0
        };
        System.assertEquals(1, InvoicingChecksBundle.evaluateINV002(
            new List<Map<String, Object>>{ i }).size());
    }

    @IsTest
    static void inv002_does_not_treat_null_as_zero() {
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Posted',
            'blng__TotalAmount__c' => null
        };
        System.assertEquals(0, InvoicingChecksBundle.evaluateINV002(
            new List<Map<String, Object>>{ i }).size(), 'null != 0 in strict semantics');
    }

    // ── INV-003 ────────────────────────────────────────────────────

    @IsTest
    static void inv003_flags_unallocated_credit_notes() {
        Map<String, Object> cn = new Map<String, Object>{
            'Id' => cnId(), 'Name' => 'CN-1', 'blng__Balance__c' => 500
        };
        List<DetectorResult> out = InvoicingChecksBundle.evaluateINV003(
            new List<Map<String, Object>>{ cn });
        System.assertEquals(1, out.size());
        System.assertEquals(500, out[0].gapUsd);
    }

    @IsTest
    static void inv003_no_fire_when_no_credit_notes() {
        System.assertEquals(0, InvoicingChecksBundle.evaluateINV003(
            new List<Map<String, Object>>()).size());
    }

    // ── INV-004: count > 10 gate ──────────────────────────────────

    @IsTest
    static void inv004_no_fire_at_10_or_fewer() {
        List<Map<String, Object>> invoices = new List<Map<String, Object>>();
        for (Integer k = 0; k < 10; k++) {
            invoices.add(new Map<String, Object>{
                'Id' => invId(), 'Name' => 'INV-' + k,
                'blng__InvoiceStatus__c' => 'Posted',
                'blng__DueDate__c' => Date.today().addDays(-30),
                'blng__TotalAmount__c' => 100
            });
        }
        System.assertEquals(0, InvoicingChecksBundle.evaluateINV004(invoices).size(),
            'Exactly 10 should NOT fire (gate is > 10)');
    }

    @IsTest
    static void inv004_fires_above_10() {
        List<Map<String, Object>> invoices = new List<Map<String, Object>>();
        for (Integer k = 0; k < 11; k++) {
            invoices.add(new Map<String, Object>{
                'Id' => invId(), 'Name' => 'INV-' + k,
                'blng__InvoiceStatus__c' => 'Posted',
                'blng__DueDate__c' => Date.today().addDays(-30),
                'blng__TotalAmount__c' => 100
            });
        }
        List<DetectorResult> out = InvoicingChecksBundle.evaluateINV004(invoices);
        System.assertEquals(1, out.size());
        System.assertEquals(1100, out[0].gapUsd);
    }

    // ── INV-005 ────────────────────────────────────────────────────

    @IsTest
    static void inv005_flags_posted_invoice_without_legal_entity() {
        // Field must be present in the row map (representing query
        // included it); value null means missing.
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Posted',
            'blng__LegalEntity__c' => null
        };
        System.assertEquals(1, InvoicingChecksBundle.evaluateINV005(
            new List<Map<String, Object>>{ i }).size());
    }

    @IsTest
    static void inv005_no_fire_when_field_not_in_select() {
        // If query didn't include blng__LegalEntity__c, the map key
        // won't exist — bundle treats as "field not available" and skips.
        Map<String, Object> i = new Map<String, Object>{
            'Id' => invId(), 'Name' => 'INV-1',
            'blng__InvoiceStatus__c' => 'Posted'
            // no blng__LegalEntity__c key at all
        };
        System.assertEquals(0, InvoicingChecksBundle.evaluateINV005(
            new List<Map<String, Object>>{ i }).size());
    }

    // ── Bundle orchestration ──────────────────────────────────────

    @IsTest
    static void bundles_report_correct_ids() {
        System.assertEquals('BR-BUNDLE', new BillingRuleBundle().getDetectorId());
        System.assertEquals('INV-BUNDLE', new InvoicingChecksBundle().getDetectorId());
    }

    @IsTest
    static void br_bundle_returns_empty_on_empty_stubs() {
        BillingRuleBundle.testStubProducts = new List<Map<String, Object>>();
        BillingRuleBundle.testStubRules = new List<Map<String, Object>>();
        BillingRuleBundle.testStubGlTreatments = new List<Map<String, Object>>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ+Billing');
        System.assertEquals(0, new BillingRuleBundle().run(ctx).size());
    }

    @IsTest
    static void inv_bundle_returns_empty_on_empty_stubs() {
        InvoicingChecksBundle.testStubInvoices = new List<Map<String, Object>>();
        InvoicingChecksBundle.testStubCreditNotes = new List<Map<String, Object>>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ+Billing');
        System.assertEquals(0, new InvoicingChecksBundle().run(ctx).size());
    }
}
