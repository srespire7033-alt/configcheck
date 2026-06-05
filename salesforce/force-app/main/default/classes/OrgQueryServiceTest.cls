/**
 * Phase 22i — covers schema-tolerant query helper.
 */
@isTest
private class OrgQueryServiceTest {

    private static DetectorContext localCtx() {
        return new DetectorContext(null, 'USD', null);
    }

    /** Helper — produce a real Exception instance with the given message. */
    private static Exception capture(String msg) {
        try {
            throw new OrgQueryService.OrgQueryException(msg);
        } catch (Exception e) {
            return e;
        }
    }

    @isTest
    static void isSchemaVarianceError_matchesKnownPatterns() {
        System.assert(OrgQueryService.isSchemaVarianceError(
            capture('Remote query HTTP 400: INVALID_FIELD No such column')),
            'INVALID_FIELD should match');
        System.assert(OrgQueryService.isSchemaVarianceError(
            capture('sObject type RateCardEntry is not supported.')),
            '"is not supported" should match');
        System.assert(OrgQueryService.isSchemaVarianceError(
            capture('INVALID_TYPE error')),
            'INVALID_TYPE should match');
        System.assert(OrgQueryService.isSchemaVarianceError(
            capture('Did not understand relationship Foo__r')),
            'relationship error should match');
        System.assert(!OrgQueryService.isSchemaVarianceError(
            capture('Read timed out')),
            'Network timeout should NOT match');
    }

    @isTest
    static void queryWithFallback_returnsLooseResultOnBadField() {
        // Strict references a column that doesn't exist on Account;
        // Loose is valid. Expect fallback path → loose result returned.
        List<Map<String, Object>> rows = OrgQueryService.queryWithFallback(localCtx(),
            'SELECT Id, ThisFieldDoesNotExist__c FROM Account LIMIT 1',
            'SELECT Id FROM Account LIMIT 1');
        System.assertNotEquals(null, rows, 'Fallback should produce a list, not null');
    }

    @isTest
    static void queryWithFallback_returnsEmptyWhenLooseIsNullAndStrictFails() {
        List<Map<String, Object>> rows = OrgQueryService.queryWithFallback(localCtx(),
            'SELECT Id FROM NoSuchObject__c LIMIT 1',
            null);
        System.assertEquals(0, rows.size(),
            'When loose=null and strict fails, return empty cleanly');
    }

    @isTest
    static void query_localPath_simpleQuery() {
        // Exercises LOCAL Database.query + normalizeLocal + sobjectToMap.
        // UserInfo guarantees one User row exists.
        Id myId = UserInfo.getUserId();
        List<Map<String, Object>> rows = OrgQueryService.query(localCtx(),
            'SELECT Id, Name FROM User WHERE Id = \'' + myId + '\' LIMIT 1');
        System.assertEquals(1, rows.size());
        System.assert(rows[0].containsKey('Id'));
        System.assert(rows[0].containsKey('Name'));
    }

    @isTest
    static void query_localPath_emptyResult() {
        List<Map<String, Object>> rows = OrgQueryService.query(localCtx(),
            'SELECT Id FROM Account WHERE Name = \'__NoSuchAccount__OrgPrismTest\' LIMIT 1');
        System.assertEquals(0, rows.size());
    }

    /**
     * Mock HTTP callout for remote-path coverage.
     */
    private class MockRemoteOk implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(200);
            r.setBody('{"totalSize":1,"done":true,"records":[' +
                '{"attributes":{"type":"Account"},"Id":"001000000000001","Name":"Mock"}' +
                ']}');
            return r;
        }
    }
    private class MockRemoteSchemaErr implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(400);
            r.setBody('[{"message":"sObject type Foo__c is not supported.","errorCode":"INVALID_TYPE"}]');
            return r;
        }
    }

    private static DetectorContext remoteCtx() {
        return new DetectorContext(null, 'USD', null, '000000000000000AAA', 'TestNamedCred');
    }

    @isTest
    static void query_remotePath_parsesRecords() {
        Test.setMock(HttpCalloutMock.class, new MockRemoteOk());
        Test.startTest();
        List<Map<String, Object>> rows = OrgQueryService.query(remoteCtx(),
            'SELECT Id, Name FROM Account LIMIT 1');
        Test.stopTest();
        System.assertEquals(1, rows.size());
        System.assertEquals('Mock', rows[0].get('Name'));
    }

    @isTest
    static void queryWithFallback_remotePath_returnsEmptyOnInvalidType() {
        Test.setMock(HttpCalloutMock.class, new MockRemoteSchemaErr());
        Test.startTest();
        List<Map<String, Object>> rows = OrgQueryService.queryWithFallback(remoteCtx(),
            'SELECT Id FROM Foo__c LIMIT 1', null);
        Test.stopTest();
        System.assertEquals(0, rows.size(),
            'Remote INVALID_TYPE should be treated as schema variance and return empty');
    }

    @isTest
    static void query_rejectsNullContext() {
        try {
            OrgQueryService.query(null, 'SELECT Id FROM Account LIMIT 1');
            System.assert(false, 'should have thrown');
        } catch (OrgQueryService.OrgQueryException e) {
            System.assert(e.getMessage().contains('DetectorContext'));
        }
    }

    @isTest
    static void query_rejectsBlankSoql() {
        try {
            OrgQueryService.query(localCtx(), '   ');
            System.assert(false, 'should have thrown');
        } catch (OrgQueryService.OrgQueryException e) {
            System.assert(e.getMessage().contains('SOQL'));
        }
    }

    @isTest
    static void queryWithFallback_returnsEmptyWhenBothFail() {
        List<Map<String, Object>> rows = OrgQueryService.queryWithFallback(localCtx(),
            'SELECT Id FROM NoSuchObject1__c LIMIT 1',
            'SELECT Id FROM NoSuchObject2__c LIMIT 1');
        System.assertEquals(0, rows.size(),
            'When both strict and loose fail on schema variance, return empty');
    }
}
