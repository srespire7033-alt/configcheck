/**
 * Phase 22a-3 — Tests for the 14 BN/PRD/CA checks across 2 new bundles
 * + the 4 PRD extensions to ProductRuleChecksBundle.
 */
@IsTest
private class Phase22a3Test {

    // ── helpers ────────────────────────────────────────────────────

    private static Integer idCounter = 0;
    private static Id mkId(String prefix3) {
        idCounter++;
        String suffix = String.valueOf(idCounter);
        while (suffix.length() < 12) suffix = '0' + suffix;
        return (Id) (prefix3 + suffix);
    }
    private static Id pid() { return mkId('01t'); }
    private static Id oid() { return mkId('a0o'); }
    private static Id rid() { return mkId('a0p'); }
    private static Id aid() { return mkId('a0a'); }

    private static Map<String, Object> sub(List<Map<String, Object>> records) {
        return new Map<String, Object>{ 'records' => records };
    }
    private static Map<String, Object> rel(String name) {
        return new Map<String, Object>{ 'Name' => name };
    }
    private static Map<String, Object> relProduct(String name, Boolean active) {
        return new Map<String, Object>{ 'Name' => name, 'IsActive' => active };
    }

    // ── BN-001 ────────────────────────────────────────────────────

    @IsTest
    static void bn001_flags_bundle_with_no_options() {
        Id bundleId = pid();
        Map<String, Object> bundle = new Map<String, Object>{
            'Id' => bundleId, 'Name' => 'Empty Bundle', 'IsActive' => true,
            'SBQQ__ConfigurationType__c' => 'Allowed'
        };
        // No options for this bundle.
        List<DetectorResult> out = BundleIntegrityChecksBundle.evaluateBN001(
            new List<Map<String, Object>>{ bundle },
            new List<Map<String, Object>>());
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void bn001_no_fire_when_bundle_has_options() {
        Id bundleId = pid();
        Map<String, Object> bundle = new Map<String, Object>{
            'Id' => bundleId, 'Name' => 'Fine Bundle', 'IsActive' => true,
            'SBQQ__ConfigurationType__c' => 'Allowed'
        };
        Map<String, Object> opt = new Map<String, Object>{
            'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => bundleId,
            'SBQQ__OptionalSKU__c' => pid()
        };
        System.assertEquals(0, BundleIntegrityChecksBundle.evaluateBN001(
            new List<Map<String, Object>>{ bundle },
            new List<Map<String, Object>>{ opt }).size());
    }

    // ── BN-002 ────────────────────────────────────────────────────

    @IsTest
    static void bn002_flags_min_greater_than_max() {
        Map<String, Object> opt = new Map<String, Object>{
            'Id' => oid(), 'Name' => 'OptX',
            'SBQQ__MinQuantity__c' => 10, 'SBQQ__MaxQuantity__c' => 5,
            'SBQQ__ConfiguredSKU__r' => rel('B1'),
            'SBQQ__OptionalSKU__r' => rel('P1')
        };
        List<DetectorResult> out = BundleIntegrityChecksBundle.evaluateBN002(
            new List<Map<String, Object>>{ opt });
        System.assertEquals(1, out.size());
        System.assert(out[0].description.contains('Min Quantity (10)'));
    }

    // ── BN-003 ────────────────────────────────────────────────────

    @IsTest
    static void bn003_flags_4_level_chain() {
        // root -> a -> b -> c -> d (depth 5 from root)
        Id root = pid(); Id a = pid(); Id b = pid(); Id c = pid(); Id d = pid();
        List<Map<String, Object>> products = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => root, 'Name' => 'Root' },
            new Map<String, Object>{ 'Id' => a, 'Name' => 'A' },
            new Map<String, Object>{ 'Id' => b, 'Name' => 'B' },
            new Map<String, Object>{ 'Id' => c, 'Name' => 'C' },
            new Map<String, Object>{ 'Id' => d, 'Name' => 'D' }
        };
        List<Map<String, Object>> options = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => root, 'SBQQ__OptionalSKU__c' => a },
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => a,    'SBQQ__OptionalSKU__c' => b },
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => b,    'SBQQ__OptionalSKU__c' => c },
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => c,    'SBQQ__OptionalSKU__c' => d }
        };
        List<DetectorResult> out = BundleIntegrityChecksBundle.evaluateBN003(products, options);
        System.assertEquals(1, out.size(), 'Depth 4+ chain should fire');
    }

    @IsTest
    static void bn003_no_fire_when_depth_3_or_less() {
        Id root = pid(); Id a = pid(); Id b = pid();
        List<Map<String, Object>> products = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => root, 'Name' => 'Root' },
            new Map<String, Object>{ 'Id' => a, 'Name' => 'A' },
            new Map<String, Object>{ 'Id' => b, 'Name' => 'B' }
        };
        List<Map<String, Object>> options = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => root, 'SBQQ__OptionalSKU__c' => a },
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => a,    'SBQQ__OptionalSKU__c' => b }
        };
        System.assertEquals(0, BundleIntegrityChecksBundle.evaluateBN003(products, options).size());
    }

    // ── BN-004 ────────────────────────────────────────────────────

    @IsTest
    static void bn004_flags_required_option_no_pbe() {
        Id childId = pid();
        Map<String, Object> opt = new Map<String, Object>{
            'Id' => oid(), 'Name' => 'OptX',
            'SBQQ__Required__c' => true,
            'SBQQ__OptionalSKU__c' => childId,
            'SBQQ__OptionalSKU__r' => relProduct('Child', true),
            'SBQQ__ConfiguredSKU__r' => rel('Bundle')
        };
        List<DetectorResult> out = BundleIntegrityChecksBundle.evaluateBN004(
            new List<Map<String, Object>>{ opt }, new Set<Id>());
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    @IsTest
    static void bn004_no_fire_when_child_inactive() {
        Id childId = pid();
        Map<String, Object> opt = new Map<String, Object>{
            'Id' => oid(), 'Name' => 'OptX',
            'SBQQ__Required__c' => true,
            'SBQQ__OptionalSKU__c' => childId,
            'SBQQ__OptionalSKU__r' => relProduct('Child', false),
            'SBQQ__ConfiguredSKU__r' => rel('Bundle')
        };
        // Inactive child means the option isn't usable anyway — skip.
        System.assertEquals(0, BundleIntegrityChecksBundle.evaluateBN004(
            new List<Map<String, Object>>{ opt }, new Set<Id>()).size());
    }

    // ── BN-005 ────────────────────────────────────────────────────

    @IsTest
    static void bn005_flags_5_plus_options_all_ungrouped() {
        Id bundleId = pid();
        List<Map<String, Object>> opts = new List<Map<String, Object>>();
        for (Integer i = 0; i < 5; i++) {
            opts.add(new Map<String, Object>{
                'Id' => oid(), 'Name' => 'O' + i,
                'SBQQ__ConfiguredSKU__c' => bundleId,
                'SBQQ__ConfiguredSKU__r' => rel('B1'),
                'SBQQ__Feature__c' => null
            });
        }
        System.assertEquals(1, BundleIntegrityChecksBundle.evaluateBN005(opts).size());
    }

    @IsTest
    static void bn005_no_fire_when_any_option_has_feature() {
        Id bundleId = pid();
        List<Map<String, Object>> opts = new List<Map<String, Object>>();
        for (Integer i = 0; i < 5; i++) {
            opts.add(new Map<String, Object>{
                'Id' => oid(), 'Name' => 'O' + i,
                'SBQQ__ConfiguredSKU__c' => bundleId,
                'SBQQ__ConfiguredSKU__r' => rel('B1'),
                'SBQQ__Feature__c' => i == 0 ? aid() : null
            });
        }
        System.assertEquals(0, BundleIntegrityChecksBundle.evaluateBN005(opts).size());
    }

    // ── BN-006 ────────────────────────────────────────────────────

    @IsTest
    static void bn006_flags_evergreen_plus_renewable_in_same_bundle() {
        Id bundleId = pid();
        Id ergId = pid(); Id renId = pid();
        List<Map<String, Object>> products = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => bundleId, 'Name' => 'Mixed', 'SBQQ__SubscriptionType__c' => null },
            new Map<String, Object>{ 'Id' => ergId, 'Name' => 'EvgProd', 'SBQQ__SubscriptionType__c' => 'Evergreen' },
            new Map<String, Object>{ 'Id' => renId, 'Name' => 'RenProd', 'SBQQ__SubscriptionType__c' => 'Renewable' }
        };
        List<Map<String, Object>> options = new List<Map<String, Object>>{
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => bundleId,
                'SBQQ__OptionalSKU__c' => ergId, 'SBQQ__OptionalSKU__r' => rel('EvgProd') },
            new Map<String, Object>{ 'Id' => oid(), 'SBQQ__ConfiguredSKU__c' => bundleId,
                'SBQQ__OptionalSKU__c' => renId, 'SBQQ__OptionalSKU__r' => rel('RenProd') }
        };
        List<DetectorResult> out = BundleIntegrityChecksBundle.evaluateBN006(products, options);
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    // ── PRD-001 ───────────────────────────────────────────────────

    @IsTest
    static void prd001_flags_add_and_remove_same_product() {
        Id targetProd = pid();
        Map<String, Object> addRule = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'AddRule', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Selection',
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Type__c' => 'Add', 'SBQQ__Product__c' => targetProd }
            })
        };
        Map<String, Object> removeRule = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'RemoveRule', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Selection',
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'SBQQ__Type__c' => 'Hide', 'SBQQ__Product__c' => targetProd }
            })
        };
        List<DetectorResult> out = ProductRuleChecksBundle.evaluatePRD001(
            new List<Map<String, Object>>{ addRule, removeRule });
        System.assertEquals(1, out.size());
        System.assertEquals('Critical', out[0].severity);
    }

    // ── PRD-002 ───────────────────────────────────────────────────

    @IsTest
    static void prd002_flags_same_type_same_order() {
        Map<String, Object> r1 = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Validation', 'SBQQ__EvaluationOrder__c' => 10,
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>())
        };
        Map<String, Object> r2 = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'V2', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Validation', 'SBQQ__EvaluationOrder__c' => 10,
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>())
        };
        List<DetectorResult> out = ProductRuleChecksBundle.evaluatePRD002(
            new List<Map<String, Object>>{ r1, r2 });
        System.assertEquals(1, out.size());
    }

    // ── PRD-003 ───────────────────────────────────────────────────

    @IsTest
    static void prd003_flags_no_conditions_no_actions() {
        Map<String, Object> r = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'Lonely', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Validation',
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>()),
            'SBQQ__ErrorConditions__r' => sub(new List<Map<String, Object>>())
        };
        System.assertEquals(1, ProductRuleChecksBundle.evaluatePRD003(
            new List<Map<String, Object>>{ r }).size());
    }

    @IsTest
    static void prd003_no_fire_when_has_conditions() {
        Map<String, Object> r = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'Has Cond', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Validation',
            'SBQQ__Actions__r' => sub(new List<Map<String, Object>>()),
            'SBQQ__ErrorConditions__r' => sub(new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => aid() }
            })
        };
        System.assertEquals(0, ProductRuleChecksBundle.evaluatePRD003(
            new List<Map<String, Object>>{ r }).size());
    }

    // ── PRD-004 ───────────────────────────────────────────────────

    @IsTest
    static void prd004_flags_validation_without_conditions_met() {
        Map<String, Object> r = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'V1', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Validation', 'SBQQ__ConditionsMet__c' => null
        };
        System.assertEquals(1, ProductRuleChecksBundle.evaluatePRD004(
            new List<Map<String, Object>>{ r }).size());
    }

    @IsTest
    static void prd004_no_fire_for_selection_rules() {
        Map<String, Object> r = new Map<String, Object>{
            'Id' => rid(), 'Name' => 'S1', 'SBQQ__Active__c' => true,
            'SBQQ__Type__c' => 'Selection', 'SBQQ__ConditionsMet__c' => null
        };
        System.assertEquals(0, ProductRuleChecksBundle.evaluatePRD004(
            new List<Map<String, Object>>{ r }).size());
    }

    // ── CA-001..004 ───────────────────────────────────────────────

    @IsTest
    static void ca001_flags_hidden_and_required() {
        Map<String, Object> attr = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'Color', 'SBQQ__Product__c' => pid(),
            'SBQQ__Product__r' => rel('Widget'),
            'SBQQ__Required__c' => true, 'SBQQ__Hidden__c' => true
        };
        List<DetectorResult> out = ConfigurationAttributeChecksBundle.evaluateCA001(
            new List<Map<String, Object>>{ attr });
        System.assertEquals(1, out.size());
        // Severity comes from Detector__mdt.CA_001 / CustomDetector__mdt.CA_001
        // (Warning). The detector defaults to Critical if no record is found
        // but the metadata overrides — test follows the configured value.
        System.assertEquals('Warning', out[0].severity);
    }

    @IsTest
    static void ca002_groups_by_product() {
        Id prod = pid();
        Map<String, Object> a1 = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'A1', 'SBQQ__Product__c' => prod,
            'SBQQ__Product__r' => rel('Widget'), 'SBQQ__TargetField__c' => null
        };
        Map<String, Object> a2 = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'A2', 'SBQQ__Product__c' => prod,
            'SBQQ__Product__r' => rel('Widget'), 'SBQQ__TargetField__c' => null
        };
        List<DetectorResult> out = ConfigurationAttributeChecksBundle.evaluateCA002(
            new List<Map<String, Object>>{ a1, a2 });
        System.assertEquals(1, out.size(), 'Two attrs on same product = 1 grouped finding');
    }

    @IsTest
    static void ca003_flags_duplicate_name_on_product() {
        Id prod = pid();
        Map<String, Object> a1 = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'Color', 'SBQQ__Product__c' => prod,
            'SBQQ__Product__r' => rel('Widget')
        };
        Map<String, Object> a2 = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'Color', 'SBQQ__Product__c' => prod,
            'SBQQ__Product__r' => rel('Widget')
        };
        System.assertEquals(1, ConfigurationAttributeChecksBundle.evaluateCA003(
            new List<Map<String, Object>>{ a1, a2 }).size());
    }

    @IsTest
    static void ca004_flags_required_visible_no_default() {
        Map<String, Object> a = new Map<String, Object>{
            'Id' => aid(), 'Name' => 'Color', 'SBQQ__Product__c' => pid(),
            'SBQQ__Product__r' => rel('Widget'),
            'SBQQ__Required__c' => true, 'SBQQ__Hidden__c' => false,
            'SBQQ__DefaultField__c' => null
        };
        List<DetectorResult> out = ConfigurationAttributeChecksBundle.evaluateCA004(
            new List<Map<String, Object>>{ a });
        System.assertEquals(1, out.size());
        System.assertEquals('Info', out[0].severity);
    }

    // ── Bundle orchestration sanity ────────────────────────────────

    @IsTest
    static void bundles_have_correct_ids() {
        System.assertEquals('BN-BUNDLE', new BundleIntegrityChecksBundle().getDetectorId());
        System.assertEquals('CA-BUNDLE', new ConfigurationAttributeChecksBundle().getDetectorId());
    }

    @IsTest
    static void bn_bundle_returns_empty_on_empty_stubs() {
        BundleIntegrityChecksBundle.testStubProducts = new List<Map<String, Object>>();
        BundleIntegrityChecksBundle.testStubOptions = new List<Map<String, Object>>();
        BundleIntegrityChecksBundle.testStubPricebookProductIds = new Set<Id>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(0, new BundleIntegrityChecksBundle().run(ctx).size());
    }

    @IsTest
    static void ca_bundle_returns_empty_on_empty_stub() {
        ConfigurationAttributeChecksBundle.testStubRows = new List<Map<String, Object>>();
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(0, new ConfigurationAttributeChecksBundle().run(ctx).size());
    }
}
