@IsTest
private class SchemaUtilTest {

    @IsTest
    static void hasObject_returns_true_for_standard_object() {
        System.assertEquals(true, SchemaUtil.hasObject('Account'));
    }

    @IsTest
    static void hasObject_returns_false_for_unknown() {
        System.assertEquals(false, SchemaUtil.hasObject('NotARealObject__c'));
    }

    @IsTest
    static void hasObject_returns_false_for_blank() {
        System.assertEquals(false, SchemaUtil.hasObject(null));
        System.assertEquals(false, SchemaUtil.hasObject(''));
    }

    @IsTest
    static void hasField_returns_true_for_standard_field() {
        System.assertEquals(true, SchemaUtil.hasField('Account', 'Name'));
    }

    @IsTest
    static void hasField_returns_false_for_unknown_field() {
        System.assertEquals(false, SchemaUtil.hasField('Account', 'NotARealField__c'));
    }

    @IsTest
    static void hasField_returns_false_for_unknown_object() {
        System.assertEquals(false, SchemaUtil.hasField('NotARealObject__c', 'Name'));
    }

    @IsTest
    static void hasField_returns_false_for_blank() {
        System.assertEquals(false, SchemaUtil.hasField(null, 'Name'));
        System.assertEquals(false, SchemaUtil.hasField('Account', null));
    }

    @IsTest
    static void hasField_caches_describe_across_calls() {
        SchemaUtil.describeCache.clear();
        SchemaUtil.hasField('Account', 'Name');
        System.assert(SchemaUtil.describeCache.containsKey('Account'),
            'First call should populate the describe cache.');
        // Second call hits the cache (we can't assert that directly without
        // a counter, but the test confirms the cache is populated).
        SchemaUtil.hasField('Account', 'Id');
        System.assertEquals(1, SchemaUtil.describeCache.size());
    }
}
