@isTest
private class RemoteOrgServiceTest {

    @isTest
    static void listConnectedOrgsWithScanStats_aggregatesLatestScanStats() {
        // Two orgs: one with two completed scans (delta should appear),
        // one with no scans (stats should stay null).
        ConnectedOrg__c orgA = new ConnectedOrg__c(
            Name = 'Org A', InstanceUrl__c = 'https://a.my.salesforce.com',
            NamedCredentialName__c = 'NC_A', OrgType__c = 'Production',
            ProductType__c = 'CPQ;CPQ+Billing', Status__c = 'Connected'
        );
        ConnectedOrg__c orgB = new ConnectedOrg__c(
            Name = 'Org B', InstanceUrl__c = 'https://b.my.salesforce.com',
            NamedCredentialName__c = 'NC_B', OrgType__c = 'Sandbox',
            ProductType__c = 'ARM', Status__c = 'Connected'
        );
        insert new List<ConnectedOrg__c>{ orgA, orgB };

        // Older scan for Org A: score 65
        ForensicScan__c older = new ForensicScan__c(
            ConnectedOrg__c = orgA.Id, ProductType__c = 'CPQ',
            Status__c = 'Completed', StartedAt__c = System.now().addDays(-3),
            CompletedAt__c = System.now().addDays(-3),
            HealthScore__c = 65, FindingCount__c = 12
        );
        insert older;

        // Newer scan for Org A: score 72 → delta = +7
        ForensicScan__c newer = new ForensicScan__c(
            ConnectedOrg__c = orgA.Id, ProductType__c = 'CPQ',
            Status__c = 'Completed', StartedAt__c = System.now().addDays(-1),
            CompletedAt__c = System.now().addDays(-1),
            HealthScore__c = 72, FindingCount__c = 10
        );
        insert newer;

        // 3 critical findings on the newer scan.
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        for (Integer i = 0; i < 3; i++) {
            findings.add(new ForensicFinding__c(
                ForensicScan__c = newer.Id,
                DetectorId__c = 'REN-001',
                Severity__c = 'Critical',
                Title__c = 'Critical finding ' + i,
                Status__c = 'Open',
                DetectedAt__c = System.now()
            ));
        }
        insert findings;

        Test.startTest();
        List<RemoteOrgService.ConnectedOrgDto> rows = RemoteOrgService.listConnectedOrgsWithScanStats();
        Test.stopTest();

        System.assertEquals(2, rows.size(), 'Expect 2 connected orgs');

        RemoteOrgService.ConnectedOrgDto dtoA;
        RemoteOrgService.ConnectedOrgDto dtoB;
        for (RemoteOrgService.ConnectedOrgDto d : rows) {
            if (d.id == orgA.Id) dtoA = d;
            if (d.id == orgB.Id) dtoB = d;
        }

        System.assertEquals(72, dtoA.score, 'Org A score should be latest (72)');
        System.assertEquals(7, dtoA.scoreDelta, 'Delta should be 72-65=+7');
        System.assertEquals(3, dtoA.criticalCount, 'Org A has 3 critical findings');
        System.assertEquals(10, dtoA.totalFindings, 'Org A finding count from scan');
        System.assertEquals(newer.Id, dtoA.latestScanId);
        System.assertEquals('CPQ;CPQ+Billing', dtoA.productType);

        System.assertEquals(null, dtoB.score, 'Org B has no scans → null score');
        System.assertEquals(null, dtoB.latestScanId, 'Org B has no latest scan');
        System.assertEquals('ARM', dtoB.productType);
    }

    @isTest
    static void listConnectedOrgsWithScanStats_handlesEmpty() {
        Test.startTest();
        List<RemoteOrgService.ConnectedOrgDto> rows = RemoteOrgService.listConnectedOrgsWithScanStats();
        Test.stopTest();
        System.assertEquals(0, rows.size(), 'No connected orgs → empty list');
    }


    /** Mock that returns 200 + valid Organization JSON when called. */
    private class OkMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"totalSize":1,"done":true,"records":[{"attributes":{"type":"Organization"},"Id":"00DHp000004AalgMAC","Name":"Acme Co"}]}');
            return res;
        }
    }

    /** Mock that returns 401 Unauthorized. */
    private class AuthFailMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(401);
            res.setBody('[{"message":"Session expired or invalid","errorCode":"INVALID_SESSION_ID"}]');
            return res;
        }
    }

    /** Mock that throws a CalloutException (network failure). */
    private class CalloutFailMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            throw new CalloutException('Unable to tunnel through proxy');
        }
    }

    @isTest
    static void listConnectedOrgsReturnsRows() {
        ConnectedOrg__c row = new ConnectedOrg__c(
            Name = 'Acme Production',
            InstanceUrl__c = 'https://acme.my.salesforce.com',
            NamedCredentialName__c = 'Acme_Production',
            OrgType__c = 'Production',
            Status__c = 'Not Tested'
        );
        insert row;

        Test.startTest();
        List<RemoteOrgService.ConnectedOrgDto> rows = RemoteOrgService.listConnectedOrgs();
        Test.stopTest();

        System.assertEquals(1, rows.size());
        System.assertEquals('Acme Production', rows[0].name);
        System.assertEquals('Acme_Production', rows[0].namedCredential);
    }

    @isTest
    static void testConnectionSuccess() {
        ConnectedOrg__c row = new ConnectedOrg__c(
            Name = 'Acme Production',
            InstanceUrl__c = 'https://acme.my.salesforce.com',
            NamedCredentialName__c = 'Acme_Production',
            OrgType__c = 'Production',
            Status__c = 'Not Tested'
        );
        insert row;

        Test.setMock(HttpCalloutMock.class, new OkMock());
        Test.startTest();
        RemoteOrgService.ConnectionResult res = RemoteOrgService.testConnection(row.Id);
        Test.stopTest();

        System.assertEquals(true, res.ok);
        System.assertEquals('00DHp000004AalgMAC', res.remoteOrgId);
        System.assertEquals('Acme Co', res.remoteOrgName);

        ConnectedOrg__c reloaded = [SELECT Status__c, RemoteOrgId__c, LastConnectedAt__c, LastError__c
                                    FROM ConnectedOrg__c WHERE Id = :row.Id];
        System.assertEquals('Connected', reloaded.Status__c);
        System.assertEquals('00DHp000004AalgMAC', reloaded.RemoteOrgId__c);
        System.assertNotEquals(null, reloaded.LastConnectedAt__c);
        System.assertEquals(null, reloaded.LastError__c);
    }

    @isTest
    static void testConnectionAuthFail() {
        ConnectedOrg__c row = new ConnectedOrg__c(
            Name = 'Bad Auth Org',
            InstanceUrl__c = 'https://bad.my.salesforce.com',
            NamedCredentialName__c = 'Bad_Auth_Org',
            OrgType__c = 'Sandbox',
            Status__c = 'Not Tested'
        );
        insert row;

        Test.setMock(HttpCalloutMock.class, new AuthFailMock());
        Test.startTest();
        RemoteOrgService.ConnectionResult res = RemoteOrgService.testConnection(row.Id);
        Test.stopTest();

        System.assertEquals(false, res.ok);
        System.assert(res.error.contains('401'), 'Should mention HTTP 401');
        ConnectedOrg__c reloaded = [SELECT Status__c, LastError__c FROM ConnectedOrg__c WHERE Id = :row.Id];
        System.assertEquals('Auth Failed', reloaded.Status__c);
    }

    @isTest
    static void testConnectionCalloutException() {
        ConnectedOrg__c row = new ConnectedOrg__c(
            Name = 'Unreachable Org',
            InstanceUrl__c = 'https://nope.my.salesforce.com',
            NamedCredentialName__c = 'Unreachable_Org',
            OrgType__c = 'Sandbox',
            Status__c = 'Not Tested'
        );
        insert row;

        Test.setMock(HttpCalloutMock.class, new CalloutFailMock());
        Test.startTest();
        RemoteOrgService.ConnectionResult res = RemoteOrgService.testConnection(row.Id);
        Test.stopTest();

        System.assertEquals(false, res.ok);
        ConnectedOrg__c reloaded = [SELECT Status__c, LastError__c FROM ConnectedOrg__c WHERE Id = :row.Id];
        System.assertEquals('Unreachable', reloaded.Status__c);
        System.assert(reloaded.LastError__c.contains('Callout exception'));
    }

    @isTest
    static void testConnectionMissingNamedCredential() {
        ConnectedOrg__c row = new ConnectedOrg__c(
            Name = 'No NC Org',
            InstanceUrl__c = 'https://noNc.my.salesforce.com',
            NamedCredentialName__c = 'placeholder',
            OrgType__c = 'Sandbox',
            Status__c = 'Not Tested'
        );
        insert row;
        // Now blank it out via direct DML so our validation path fires
        row.NamedCredentialName__c = '';
        // Bypass validation-required field by going through direct update with allOrNone false
        Database.SaveResult sr = Database.update(row, false);
        // If validation prevents the blank, simulate by passing a null id instead
        Test.startTest();
        RemoteOrgService.ConnectionResult res = RemoteOrgService.testConnection(
            sr.isSuccess() ? row.Id : null
        );
        Test.stopTest();
        System.assertEquals(false, res.ok);
        System.assertNotEquals(null, res.error);
    }

    @isTest
    static void testConnectionUnknownId() {
        Test.startTest();
        // Pass a fake but valid Id (use a record we will delete first)
        ConnectedOrg__c stub = new ConnectedOrg__c(
            Name = 'Stub', InstanceUrl__c = 'https://x.my.salesforce.com',
            NamedCredentialName__c = 'Stub', OrgType__c = 'Production', Status__c = 'Not Tested'
        );
        insert stub;
        Id stubId = stub.Id;
        delete stub;
        RemoteOrgService.ConnectionResult res = RemoteOrgService.testConnection(stubId);
        Test.stopTest();
        System.assertEquals(false, res.ok);
        System.assert(res.error.contains('not found'));
    }
}
