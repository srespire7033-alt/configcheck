@isTest
private class CustomDetectorTesterTest {

    @isTest
    static void testQuery_blankReturnsError() {
        Test.startTest();
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery('', 'CPQ', null);
        Test.stopTest();
        System.assertEquals(0, r.rowCount);
        System.assert(r.error != null && r.error.contains('Enter'), 'Blank → friendly error');
    }

    @isTest
    static void testQuery_rejectsMultiStatement() {
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery(
            'SELECT Id FROM Account; SELECT Id FROM Contact', 'CPQ', null);
        System.assert(r.error.contains('Multi-statement'), 'Semicolon rejected');
    }

    @isTest
    static void testQuery_rejectsDmlKeyword() {
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery(
            'INSERT INTO Account VALUES (1)', 'CPQ', null);
        System.assert(r.error.contains('DML'), 'INSERT rejected');
    }

    @isTest
    static void testQuery_rejectsNonSelect() {
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery(
            'CREATE TABLE foo', 'CPQ', null);
        System.assert(r.error.contains('SELECT'), 'Non-SELECT rejected');
    }

    @isTest
    static void testQuery_runsAndReturnsRows() {
        // Account is standard, always present. The actual row count is
        // org-dependent (could be 0 in a fresh scratch); we only assert
        // the SOQL ran without an error and returned a non-null result.
        Test.startTest();
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery(
            'SELECT Id, Name FROM Account LIMIT 5', 'CPQ', null);
        Test.stopTest();
        System.assertEquals(null, r.error, 'No error on legitimate SELECT');
        System.assert(r.rowCount >= 0, 'Row count populated');
        // sample list always defined, never null
        System.assertNotEquals(null, r.sample);
    }

    @isTest
    static void testQuery_badSoqlReturnsError() {
        CustomDetectorService.TestQueryResult r = CustomDetectorService.testQuery(
            'SELECT NonExistentField FROM Account', 'CPQ', null);
        System.assertNotEquals(null, r.error, 'Bad field → error string populated');
        System.assertEquals(0, r.rowCount);
    }
}
