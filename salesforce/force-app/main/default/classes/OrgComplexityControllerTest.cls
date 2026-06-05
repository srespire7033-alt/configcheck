@isTest
private class OrgComplexityControllerTest {

    @isTest
    static void returnsDtoWithEightFactors() {
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity(null);
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assertEquals(8, dto.factors.size(), '8 factors expected');
        // Without CPQ installed in test ctx, all CPQ-only counts are 0.
        // Active Products count uses Product2 which always exists, so it
        // could be 0 or > 0 depending on org. Score must be ≥ 0.
        System.assert(dto.totalScore >= 0, 'Score should be non-negative');
        // Rating must be one of the 4 buckets.
        Set<String> validRatings = new Set<String>{ 'Low', 'Moderate', 'High', 'Very High' };
        System.assert(validRatings.contains(dto.rating), 'Rating in valid set');
        System.assertNotEquals(null, dto.description);
    }

    @isTest
    static void factorsHaveExpectedShape() {
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity(null);
        Test.stopTest();
        for (OrgComplexityController.Factor f : dto.factors) {
            System.assertNotEquals(null, f.label);
            System.assertNotEquals(null, f.weight);
            System.assert(f.count >= 0);
            System.assert(f.benchmark > 0, 'Every factor has a positive benchmark');
            System.assert(f.contribution >= 0);
        }
    }

    @isTest
    static void getComplexityLocal_works() {
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexityLocal();
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assertEquals(8, dto.factors.size());
    }

    @isTest
    static void invalidConnectedOrgId_fallsBackToLocal() {
        // No record with this Id → controller should silently fall back
        // to host-local counts.
        Id fakeId = '500000000000000AAA';
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity(fakeId);
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assertEquals(8, dto.factors.size(),
            'Fallback to local should still return 8 CPQ-flavored factors');
    }

    // Mock that responds 200 OK with a COUNT(Id) aggregate body for
    // every REST query — covers the cpqFactors + armFactors loops.
    public class CountMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(200);
            r.setBody('{"totalSize":1,"done":true,"records":[{"attributes":{"type":"AggregateResult"},"c":42}]}');
            return r;
        }
    }

    @isTest
    static void remoteCpq_routesThroughCallouts() {
        ConnectedOrg__c co = new ConnectedOrg__c(
            Name = 'CPQ test',
            NamedCredentialName__c = 'TestNamedCred',
            InstanceUrl__c = 'https://test.my.salesforce.com',
            ProductType__c = 'CPQ+Billing'
        );
        insert co;
        Test.setMock(HttpCalloutMock.class, new CountMock());
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity(co.Id);
        Test.stopTest();
        System.assertEquals(8, dto.factors.size(), 'CPQ flavor → 8 factors');
        // Each factor came back as count=42 from the mock; score > 0
        System.assert(dto.totalScore > 0, 'Mock counts should produce non-zero score');
    }

    @isTest
    static void remoteArm_routesThroughCallouts() {
        ConnectedOrg__c co = new ConnectedOrg__c(
            Name = 'ARM test',
            NamedCredentialName__c = 'TestNamedCred',
            InstanceUrl__c = 'https://test-arm.my.salesforce.com',
            ProductType__c = 'ARM'
        );
        insert co;
        Test.setMock(HttpCalloutMock.class, new CountMock());
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity(co.Id);
        Test.stopTest();
        System.assertEquals(8, dto.factors.size(), 'ARM flavor → 8 factors');
        // ARM factor labels differ from CPQ; verify at least one is ARM-shape.
        Set<String> labels = new Set<String>();
        for (OrgComplexityController.Factor f : dto.factors) labels.add(f.label);
        System.assert(labels.contains('Selling Model Options')
            || labels.contains('Rate Cards')
            || labels.contains('Decision Tables'),
            'ARM factor list should contain ARM-specific labels');
    }
}
