/**
 * Currency portability helper.
 *
 * OrgPrism originally assumed every host org has multi-currency enabled
 * (because Techtorch does). Customer orgs in the wild are mostly single-
 * currency by default — `CurrencyIsoCode` is absent there, so any SOQL or
 * Apex field reference fails to compile or throws at runtime.
 *
 * This class centralises the check so every detector + controller can
 * include / exclude / read the field conditionally. The cached boolean
 * costs ~one UserInfo call per transaction.
 *
 * Usage:
 *   - In SOQL string concat:    soql += CurrencyContext.soqlSelect();
 *   - Reading from SObject:     CurrencyContext.read(record);
 *   - Reading from Map row:     CurrencyContext.readFromMap(rowMap);
 *   - In test data Map<>:       CurrencyContext.addToTestMap(m, 'USD');
 */
public with sharing class CurrencyContext {

    @TestVisible
    private static Boolean cachedMultiCurrency;

    /** Returns true when the org has multi-currency enabled. Cached per tx. */
    public static Boolean isMultiCurrency() {
        if (cachedMultiCurrency == null) {
            cachedMultiCurrency = UserInfo.isMultiCurrencyOrganization();
        }
        return cachedMultiCurrency;
    }

    /**
     * Returns ', CurrencyIsoCode' on multi-currency orgs, '' otherwise.
     * Designed to splice into Database.query string concatenation:
     *
     *   String soql = 'SELECT Id, Name' + CurrencyContext.soqlSelect()
     *               + ' FROM Account';
     */
    public static String soqlSelect() {
        return isMultiCurrency() ? ', CurrencyIsoCode' : '';
    }

    /**
     * Read CurrencyIsoCode from an SObject safely. Returns null when the
     * org is single-currency or the record is null or the field isn't
     * populated. Never throws.
     */
    public static String read(SObject record) {
        if (record == null || !isMultiCurrency()) return null;
        try { return (String) record.get('CurrencyIsoCode'); }
        catch (Exception e) { return null; }
    }

    /**
     * Read CurrencyIsoCode from a Map<String,Object> (e.g. OrgQueryService
     * row). Returns null when single-currency OR the key is absent.
     */
    public static Object readFromMap(Map<String, Object> row) {
        if (row == null || !isMultiCurrency()) return null;
        return row.get('CurrencyIsoCode');
    }

    /**
     * For test data Maps that get JSON-deserialised into SObjects: only
     * insert the field on multi-currency orgs (otherwise the deserialise
     * fails with "Invalid field" on single-currency).
     */
    public static void addToTestMap(Map<String, Object> m, String iso) {
        if (m != null && isMultiCurrency()) {
            m.put('CurrencyIsoCode', iso);
        }
    }

    /** @TestVisible — let tests force a mode without touching the org config. */
    @TestVisible
    private static void setMockMultiCurrency(Boolean b) {
        cachedMultiCurrency = b;
    }
}
