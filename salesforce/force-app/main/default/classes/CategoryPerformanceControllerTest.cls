@isTest
private class CategoryPerformanceControllerTest {

    @isTest
    static void returnsAllSectionsWithNullArg() {
        Test.startTest();
        List<CategoryPerformanceController.CategorySection> sections =
            CategoryPerformanceController.getCategoryScores(null);
        Test.stopTest();
        // Phase 22r — ARM section now seeded alongside CPQ + BILLING.
        // Null connectedOrgId arg → no product-type filter → all sections.
        System.assertEquals(3, sections.size(),
            'cpq + billing + arm should all return when no filter applied');
        System.assertEquals('cpq',     sections[0].key);
        System.assertEquals('billing', sections[1].key);
        System.assertEquals('arm',     sections[2].key);
        // Every card defaults to 100 / 0 / 0 / 0 with no scan present
        for (CategoryPerformanceController.CategoryCard c : sections[0].cards) {
            System.assertEquals(100, c.score, c.label + ' should be 100 with no data');
        }
    }

    @isTest
    static void filtersByProductType() {
        // Phase 22r — ARM-typed Connected Org should yield only ARM section.
        ConnectedOrg__c co = new ConnectedOrg__c(
            Name = 'ARM Test',
            NamedCredentialName__c = 'NC_ARM_TEST',
            InstanceUrl__c = 'https://test.my.salesforce.com',
            ProductType__c = 'ARM'
        );
        insert co;

        Test.startTest();
        List<CategoryPerformanceController.CategorySection> sections =
            CategoryPerformanceController.getCategoryScores(co.Id);
        Test.stopTest();

        System.assertEquals(1, sections.size(),
            'ARM connected org → only ARM section');
        System.assertEquals('arm', sections[0].key);
        System.assert(sections[0].cards.size() >= 1,
            'ARM section should have at least one card seeded');
    }

    @isTest
    static void appliesScoreFormulaWithFindings() {
        ForensicScan__c scan = new ForensicScan__c(Status__c='Completed',
            CompletedAt__c=System.now(), TotalLeakageUsd__c=0, FindingCount__c=4);
        insert scan;
        // 2 critical + 1 warning on ORD-FOR-001 → Billing Rules + Billing Config rows.
        // Phase 22f — formula moved to HealthScoreCalculator.computeBucketScore
        // using mdt bucket weights (default 15/5/1):
        //   raw = 100 - 2*15 - 1*5 - 0 = 65
        insert new List<ForensicFinding__c>{
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='BR-001',
                Title__c='a', Severity__c='Critical', GapUsd__c=1000,
                EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='BR-001',
                Title__c='b', Severity__c='Critical', GapUsd__c=1000,
                EntitledUsd__c=1000, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now()),
            new ForensicFinding__c(ForensicScan__c=scan.Id, DetectorId__c='BR-001',
                Title__c='c', Severity__c='Warning', GapUsd__c=500,
                EntitledUsd__c=500, RealizedUsd__c=0,
                Status__c='Open', DetectedAt__c=System.now())
        };

        Test.startTest();
        List<CategoryPerformanceController.CategorySection> sections =
            CategoryPerformanceController.getCategoryScores(null);
        Test.stopTest();

        CategoryPerformanceController.CategoryCard billingRules = null;
        for (CategoryPerformanceController.CategoryCard c : sections[1].cards) {
            if (c.key == 'billing_rules') billingRules = c;
        }
        System.assertNotEquals(null, billingRules);
        System.assertEquals(65, billingRules.score, 'Score 100 - 2×15 - 1×5 = 65');
        System.assertEquals(2, billingRules.criticalCount);
        System.assertEquals(1, billingRules.warningCount);
    }
}
