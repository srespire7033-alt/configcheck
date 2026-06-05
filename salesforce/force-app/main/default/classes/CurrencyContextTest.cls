/**
 * Tests for CurrencyContext — verifies both org modes via the @TestVisible
 * setMockMultiCurrency hook (so the test passes on Techtorch AND on a
 * single-currency org without touching org config).
 */
@IsTest
private class CurrencyContextTest {

    @IsTest
    static void isMultiCurrency_reads_userinfo_when_unset() {
        CurrencyContext.cachedMultiCurrency = null;
        Test.startTest();
        Boolean result = CurrencyContext.isMultiCurrency();
        Test.stopTest();
        // Just verify it returns a Boolean and caches it.
        System.assertNotEquals(null, result);
        System.assertNotEquals(null, CurrencyContext.cachedMultiCurrency);
    }

    @IsTest
    static void soqlSelect_returns_field_when_multi() {
        CurrencyContext.setMockMultiCurrency(true);
        System.assertEquals(', CurrencyIsoCode', CurrencyContext.soqlSelect());
    }

    @IsTest
    static void soqlSelect_returns_empty_when_single() {
        CurrencyContext.setMockMultiCurrency(false);
        System.assertEquals('', CurrencyContext.soqlSelect());
    }

    @IsTest
    static void read_returns_null_on_single_currency() {
        CurrencyContext.setMockMultiCurrency(false);
        Account a = new Account(Name = 'x');
        System.assertEquals(null, CurrencyContext.read(a));
    }

    @IsTest
    static void read_returns_null_for_null_record() {
        CurrencyContext.setMockMultiCurrency(true);
        System.assertEquals(null, CurrencyContext.read(null));
    }

    @IsTest
    static void readFromMap_returns_null_on_single_currency() {
        CurrencyContext.setMockMultiCurrency(false);
        Map<String, Object> m = new Map<String, Object>{ 'CurrencyIsoCode' => 'USD' };
        System.assertEquals(null, CurrencyContext.readFromMap(m));
    }

    @IsTest
    static void readFromMap_returns_value_when_multi() {
        CurrencyContext.setMockMultiCurrency(true);
        Map<String, Object> m = new Map<String, Object>{ 'CurrencyIsoCode' => 'EUR' };
        System.assertEquals('EUR', (String) CurrencyContext.readFromMap(m));
    }

    @IsTest
    static void readFromMap_handles_null() {
        CurrencyContext.setMockMultiCurrency(true);
        System.assertEquals(null, CurrencyContext.readFromMap(null));
    }

    @IsTest
    static void addToTestMap_adds_when_multi() {
        CurrencyContext.setMockMultiCurrency(true);
        Map<String, Object> m = new Map<String, Object>();
        CurrencyContext.addToTestMap(m, 'USD');
        System.assertEquals('USD', m.get('CurrencyIsoCode'));
    }

    @IsTest
    static void addToTestMap_skips_when_single() {
        CurrencyContext.setMockMultiCurrency(false);
        Map<String, Object> m = new Map<String, Object>();
        CurrencyContext.addToTestMap(m, 'USD');
        System.assert(!m.containsKey('CurrencyIsoCode'));
    }

    @IsTest
    static void addToTestMap_handles_null_map() {
        CurrencyContext.setMockMultiCurrency(true);
        // Should not throw.
        CurrencyContext.addToTestMap(null, 'USD');
    }
}
