@isTest
private class AttributionMapControllerTest {

    @isTest
    static void emptyOrgReturnsEmptyMap() {
        Test.startTest();
        AttributionMapController.MapDto dto = AttributionMapController.getMap();
        Test.stopTest();
        System.assertEquals(0, dto.totalRoots);
        System.assertEquals(0, dto.totalUsd);
    }

    @isTest
    static void fallsBackToDetectorGroupingWithoutTraces() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=3);
        insert scan;
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='a', Severity__c='Critical', GapUsd__c=1000,
                EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-001',
                Title__c='b', Severity__c='Critical', GapUsd__c=500,
                EntitledUsd__c=500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='REN-002',
                Title__c='c', Severity__c='Warning', GapUsd__c=2000,
                EntitledUsd__c=2000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        AttributionMapController.MapDto dto = AttributionMapController.getMap();
        Test.stopTest();

        System.assertEquals(2, dto.totalRoots, '2 distinct detectors → 2 roots');
        System.assertEquals(3500, dto.totalUsd);
        // REN-002 has bigger $ → first
        System.assertEquals('REN-002', dto.roots[0].rootConfigName);
        System.assertEquals(2000, dto.roots[0].totalUsd);
    }

    @isTest
    static void groupsByRootConfigWhenTracesExist() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=2);
        insert scan;
        ForensicFinding__c f1 = new ForensicFinding__c(ForensicScan__c=scan.Id,
            DetectorId__c='REN-001', Title__c='X', Severity__c='Critical',
            GapUsd__c=5000, EntitledUsd__c=5000, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now());
        ForensicFinding__c f2 = new ForensicFinding__c(ForensicScan__c=scan.Id,
            DetectorId__c='REN-002', Title__c='Y', Severity__c='Critical',
            GapUsd__c=3000, EntitledUsd__c=3000, RealizedUsd__c=0,
            Status__c='Open', DetectedAt__c=System.now());
        insert new List<ForensicFinding__c>{ f1, f2 };
        insert new List<AttributionTrace__c>{
            new AttributionTrace__c(ForensicFinding__c=f1.Id, RootConfigType__c='Flow',
                RootConfigName__c='Renewal Auto', RootCauseClass__c='C', Confidence__c=0.9,
                ReasonCode__c='conflicting_flow'),
            new AttributionTrace__c(ForensicFinding__c=f2.Id, RootConfigType__c='Flow',
                RootConfigName__c='Renewal Auto', RootCauseClass__c='C', Confidence__c=0.9,
                ReasonCode__c='conflicting_flow')
        };
        Test.startTest();
        AttributionMapController.MapDto dto = AttributionMapController.getMap();
        Test.stopTest();
        System.assertEquals(1, dto.totalRoots, 'Both findings share the same root config');
        System.assertEquals(8000, dto.roots[0].totalUsd);
        System.assertEquals('Conflicting automation', dto.roots[0].rootCauseClass);
    }
}
