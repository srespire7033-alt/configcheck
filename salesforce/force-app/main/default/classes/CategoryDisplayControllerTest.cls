/**
 * Phase 20b — CategoryDisplayController tests.
 *
 * Four Category__mdt records ship (revenue_leakage, governance,
 * pipeline, pricing). Plus the controller seeds those four as
 * fallbacks for fresh-org scenarios, so getAll always returns at
 * least 4 records.
 */
@IsTest
private class CategoryDisplayControllerTest {

    @IsTest
    static void getAll_returns_at_least_four_categories() {
        Test.startTest();
        List<CategoryDisplayController.CategoryDto> all1 = CategoryDisplayController.getAll();
        Test.stopTest();
        System.assert(all1.size() >= 4,
            'Expected at least 4 categories (the seeded set); got ' + all1.size());
        // Sorted by sequence — revenue_leakage(1), governance(2), pipeline(3), pricing(4)
        System.assertEquals('revenue_leakage', all1[0].categoryKey);
    }

    @IsTest
    static void getByKey_returns_known_categories() {
        for (String k : new List<String>{ 'revenue_leakage', 'governance', 'pipeline', 'pricing' }) {
            CategoryDisplayController.CategoryDto d = CategoryDisplayController.getByKey(k);
            System.assertNotEquals(null, d, 'Should return a record for ' + k);
            System.assertNotEquals(null, d.title);
            System.assertNotEquals(null, d.iconName);
        }
    }

    @IsTest
    static void getByKey_unknown_returns_null() {
        System.assertEquals(null, CategoryDisplayController.getByKey('nope_not_a_category'));
    }

    @IsTest
    static void getByKey_blank_returns_null() {
        System.assertEquals(null, CategoryDisplayController.getByKey(null));
        System.assertEquals(null, CategoryDisplayController.getByKey(''));
    }

    @IsTest
    static void seeded_governance_has_expected_shape() {
        CategoryDisplayController.CategoryDto g = CategoryDisplayController.getByKey('governance');
        System.assertEquals('Governance Risk', g.title);
        System.assertEquals('amber', g.accent);
        System.assertEquals('count', g.summaryMode);
    }
}
