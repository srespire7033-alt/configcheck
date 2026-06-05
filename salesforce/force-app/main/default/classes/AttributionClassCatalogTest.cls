/**
 * Phase 19d — AttributionClassCatalog tests.
 *
 * Five AttributionClass__mdt records ship (A-E), so the catalog is
 * always populated in any deployed org.
 */
@IsTest
private class AttributionClassCatalogTest {

    @IsTest
    static void getAll_returns_five_classes_sorted_by_letter() {
        List<AttributionClass__mdt> entries = AttributionClassCatalog.getAll();
        System.assertEquals(5, entries.size(),
            'Expected 5 attribution classes (A-E); got ' + entries.size());
        // Sorted ascending by Letter
        System.assertEquals('A', entries[0].Letter__c);
        System.assertEquals('E', entries[4].Letter__c);
    }

    @IsTest
    static void getLabel_returns_seeded_label() {
        String label = AttributionClassCatalog.getLabel('A');
        System.assertNotEquals(null, label);
        System.assert(label.toLowerCase().contains('disconnect'),
            'Class A label should describe system disconnect: ' + label);
    }

    @IsTest
    static void getLabel_blank_input_returns_null() {
        System.assertEquals(null, AttributionClassCatalog.getLabel(null));
        System.assertEquals(null, AttributionClassCatalog.getLabel(''));
    }

    @IsTest
    static void getLabel_unknown_letter_returns_letter_as_fallback() {
        // The class isn't in mdt or in the default-labels map → echo letter.
        String label = AttributionClassCatalog.getLabel('Z');
        System.assertEquals('Z', label);
    }

    @IsTest
    static void getDescription_returns_seeded_text_for_known_class() {
        String labelDesc = AttributionClassCatalog.getDescription('A');
        System.assertNotEquals(null, labelDesc);
        System.assert(labelDesc.length() > 0, 'Class A description should be non-empty');
    }

    @IsTest
    static void getDescription_unknown_letter_returns_null() {
        System.assertEquals(null, AttributionClassCatalog.getDescription('Z'));
    }
}
