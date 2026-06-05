/**
 * Phase 7+ / Phase 9 — proves the remote-scan path end-to-end with
 * mocked HTTP responses. No live remote org needed. No CPQ namespace
 * compile-time dependency.
 *
 * Tests cover:
 *   - OrgQueryService routes LOCAL when ctx is local (Database.query → Map)
 *   - OrgQueryService routes REMOTE when ctx has a Named Credential
 *   - parseRecords handles empty / populated / malformed / weird bodies
 *   - HTTP non-200 surfaces as OrgQueryException
 *   - ForensicScanService.startRemoteScan() validates inputs + inserts
 *     a ForensicScan__c with ConnectedOrg__c set
 */
@isTest
private class RemoteScanIntegrationTest {

    // ── Helpers ───────────────────────────────────────────────────────

    private static ConnectedOrg__c makeConnectedOrg() {
        ConnectedOrg__c co = new ConnectedOrg__c(
            Name = 'Mock Target Org',
            InstanceUrl__c = 'https://mock-target.my.salesforce.com',
            NamedCredentialName__c = 'Mock_Target_NC',
            OrgType__c = 'Production',
            Status__c = 'Connected'
        );
        insert co;
        return co;
    }

    /** Mock: empty result set. */
    public class EmptyResultMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"totalSize":0,"done":true,"records":[]}');
            return res;
        }
    }

    /** Mock: HTTP 500. */
    public class HttpErrorMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(500);
            res.setBody('{"message":"Internal Server Error"}');
            return res;
        }
    }

    /** Mock: malformed JSON. */
    public class GarbageMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('this is not json');
            return res;
        }
    }

    /** Mock: one record with nested relationship — proves attributes
     *  stripping and nested-map recursion. */
    public class OneRecordMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody(
                '{"totalSize":1,"done":true,"records":[' +
                  '{"attributes":{"type":"SBQQ__QuoteLine__c","url":"/x"},' +
                   '"Id":"a01000000000001AAA",' +
                   '"Name":"QL-1",' +
                   '"SBQQ__NetPrice__c":1000,' +
                   '"SBQQ__Quote__r":{"attributes":{"type":"SBQQ__Quote__c","url":"/y"},"Name":"Q-1"}}' +
                ']}'
            );
            return res;
        }
    }

    // ── Tests ─────────────────────────────────────────────────────────

    @isTest
    static void localContextRoutesToLocalQuery() {
        DetectorContext ctx = new DetectorContext(null, 'USD', 'CPQ');
        System.assertEquals(false, ctx.isRemote(), 'Local ctx should not be remote');

        // Account always exists, so local query works regardless of CPQ presence.
        Test.startTest();
        List<Map<String, Object>> rows = OrgQueryService.query(ctx, 'SELECT Id FROM Account LIMIT 1');
        Test.stopTest();
        System.assert(rows != null, 'Local query should return non-null list of maps');
    }

    @isTest
    static void remoteContextRoutesToCallout() {
        ConnectedOrg__c co = makeConnectedOrg();
        DetectorContext ctx = new DetectorContext(
            null, 'USD', 'CPQ', co.Id, co.NamedCredentialName__c
        );
        System.assertEquals(true, ctx.isRemote(), 'Remote ctx should report remote');

        Test.setMock(HttpCalloutMock.class, new EmptyResultMock());
        Test.startTest();
        List<Map<String, Object>> rows = OrgQueryService.query(ctx, 'SELECT Id FROM Account LIMIT 1');
        Test.stopTest();
        System.assertEquals(0, rows.size(), 'Empty mock should yield zero rows');
    }

    @isTest
    static void remoteHttpErrorThrowsOrgQueryException() {
        ConnectedOrg__c co = makeConnectedOrg();
        DetectorContext ctx = new DetectorContext(
            null, 'USD', 'CPQ', co.Id, co.NamedCredentialName__c
        );

        Test.setMock(HttpCalloutMock.class, new HttpErrorMock());
        Boolean threw = false;
        Test.startTest();
        try {
            OrgQueryService.query(ctx, 'SELECT Id FROM Account LIMIT 1');
        } catch (OrgQueryService.OrgQueryException e) {
            threw = true;
            System.assert(e.getMessage().contains('HTTP 500'), 'Should report HTTP status: ' + e.getMessage());
        }
        Test.stopTest();
        System.assert(threw, 'Non-200 response should throw OrgQueryException');
    }

    @isTest
    static void remoteGarbageJsonThrowsOrgQueryException() {
        ConnectedOrg__c co = makeConnectedOrg();
        DetectorContext ctx = new DetectorContext(
            null, 'USD', 'CPQ', co.Id, co.NamedCredentialName__c
        );

        Test.setMock(HttpCalloutMock.class, new GarbageMock());
        Boolean threw = false;
        Test.startTest();
        try {
            OrgQueryService.query(ctx, 'SELECT Id FROM Account LIMIT 1');
        } catch (OrgQueryService.OrgQueryException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Malformed JSON should throw OrgQueryException');
    }

    @isTest
    static void remoteQueryReturnsRecordMaps() {
        ConnectedOrg__c co = makeConnectedOrg();
        DetectorContext ctx = new DetectorContext(
            null, 'USD', 'CPQ', co.Id, co.NamedCredentialName__c
        );

        Test.setMock(HttpCalloutMock.class, new OneRecordMock());
        Test.startTest();
        List<Map<String, Object>> rows = OrgQueryService.query(ctx, 'SELECT Id, Name FROM SBQQ__QuoteLine__c');
        Test.stopTest();

        // Critical: this assertion proves the host org doesn't need CPQ.
        // We're reading SBQQ__ fields by string key from a generic map.
        System.assertEquals(1, rows.size(), 'Should parse one record');
        Map<String, Object> row = rows[0];
        System.assertEquals('QL-1', row.get('Name'));
        System.assertEquals(1000, row.get('SBQQ__NetPrice__c'));
        // Attributes block should be stripped.
        System.assert(!row.containsKey('attributes'), 'attributes wrapper should be stripped');
        // Nested relationship preserved as a nested Map.
        Object q = row.get('SBQQ__Quote__r');
        System.assert(q instanceof Map<String, Object>, 'Nested record stays a Map');
        Map<String, Object> quote = (Map<String, Object>) q;
        System.assertEquals('Q-1', quote.get('Name'));
        System.assert(!quote.containsKey('attributes'), 'Nested attributes stripped recursively');
    }

    @isTest
    static void startRemoteScanCreatesScanWithConnectedOrgLink() {
        ConnectedOrg__c co = makeConnectedOrg();
        Test.setMock(HttpCalloutMock.class, new EmptyResultMock());

        Test.startTest();
        Id scanId = ForensicScanService.startRemoteScan('CPQ', co.Id);
        Test.stopTest();

        ForensicScan__c scan = [
            SELECT Id, ConnectedOrg__c, Status__c, ProductType__c
            FROM ForensicScan__c WHERE Id = :scanId
        ];
        System.assertEquals(co.Id, scan.ConnectedOrg__c, 'Scan should link to ConnectedOrg__c');
        System.assertEquals('CPQ', scan.ProductType__c);
    }

    @isTest
    static void startRemoteScanRejectsBlankConnectedOrgId() {
        Boolean threw = false;
        try { ForensicScanService.startRemoteScan('CPQ', null); }
        catch (Exception e) { threw = true; }
        System.assert(threw, 'null connectedOrgId should be rejected');
    }

    @isTest
    static void startRemoteScanRejectsUnknownConnectedOrg() {
        Id fakeId = '0000000000000000AA';
        Boolean threw = false;
        try { ForensicScanService.startRemoteScan('CPQ', fakeId); }
        catch (Exception e) { threw = true; }
        System.assert(threw, 'Unknown connectedOrgId should be rejected');
    }
}
