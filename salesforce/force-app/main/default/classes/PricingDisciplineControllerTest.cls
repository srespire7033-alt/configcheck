@isTest
private class PricingDisciplineControllerTest {

    @isTest
    static void getDisciplineReturnsValidDto() {
        Test.startTest();
        PricingDisciplineController.DisciplineDto dto = PricingDisciplineController.getDiscipline();
        Test.stopTest();
        System.assertNotEquals(null, dto);
        System.assertEquals(25, dto.maxAllowedDiscount);
        // With no SBQQ data (object may not be installed), grade defaults to A.
        System.assertEquals('A', dto.grade);
    }

    @isTest
    static void letterGradeCoversAllTiers() {
        Test.startTest();
        System.assertEquals('A', PricingDisciplineController.letterGrade(5, 5));
        System.assertEquals('B', PricingDisciplineController.letterGrade(20, 15));
        System.assertEquals('C', PricingDisciplineController.letterGrade(30, 30));
        System.assertEquals('D', PricingDisciplineController.letterGrade(45, 45));
        System.assertEquals('F', PricingDisciplineController.letterGrade(60, 60));
        System.assertEquals('F', PricingDisciplineController.letterGrade(10, 80), 'High override alone → F');
        Test.stopTest();
    }

    @isTest
    static void narrativeReturnsPerGradeCopy() {
        System.assert(PricingDisciplineController.narrative('A', 10, 5).contains('strong'));
        System.assert(PricingDisciplineController.narrative('B', 20, 15).contains('healthy'));
        System.assert(PricingDisciplineController.narrative('C', 30, 30).contains('creep'));
        System.assert(PricingDisciplineController.narrative('D', 45, 45).contains('weakening'));
        System.assert(PricingDisciplineController.narrative('F', 60, 60).contains('not working'));
    }

    @isTest
    static void computeMedianHandlesOddAndEven() {
        System.assertEquals(0, PricingDisciplineController.computeMedian(new List<Decimal>()));
        System.assertEquals(5, PricingDisciplineController.computeMedian(new List<Decimal>{ 5 }));
        System.assertEquals(20, PricingDisciplineController.computeMedian(new List<Decimal>{ 10, 20, 30 }), 'Odd → middle');
        System.assertEquals(15, PricingDisciplineController.computeMedian(new List<Decimal>{ 10, 20, 5, 30 }), 'Even → avg of two middles after sort');
    }

    @isTest
    static void sliceTopRespectsLimit() {
        List<PricingDisciplineController.TopOffender> src = new List<PricingDisciplineController.TopOffender>();
        for (Integer i = 0; i < 8; i++) {
            PricingDisciplineController.TopOffender o = new PricingDisciplineController.TopOffender();
            o.productName = 'P' + i;
            o.lineCount = i + 1;
            o.avgDiscount = 10 + i;
            o.overrideCount = i;
            src.add(o);
        }
        System.assertEquals(5, PricingDisciplineController.sliceTop(src, 5).size());
        System.assertEquals(3, PricingDisciplineController.sliceTop(src, 3).size());
        System.assertEquals(8, PricingDisciplineController.sliceTop(src, 100).size(),
            'Limit > size → return all');
    }

    @isTest
    static void populateDtoFromRowsAggregatesCorrectly() {
        Id pA = UserInfo.getUserId();
        Id pB = UserInfo.getOrganizationId();
        List<Map<String, Object>> rows = new List<Map<String, Object>>{
            new Map<String, Object>{ 'discount' => 30, 'pricingMethod' => 'List',   'productId' => pA, 'productName' => 'Widget A' },
            new Map<String, Object>{ 'discount' => 30, 'pricingMethod' => 'Manual', 'productId' => pA, 'productName' => 'Widget A' },
            new Map<String, Object>{ 'discount' => 30, 'pricingMethod' => 'List',   'productId' => pA, 'productName' => 'Widget A' },
            new Map<String, Object>{ 'discount' => 10, 'pricingMethod' => 'List',   'productId' => pB, 'productName' => 'Widget B' },
            new Map<String, Object>{ 'discount' => 10, 'pricingMethod' => 'List',   'productId' => pB, 'productName' => 'Widget B' },
            new Map<String, Object>{ 'discount' => 5,  'pricingMethod' => null,     'productId' => null, 'productName' => null }
        };
        PricingDisciplineController.DisciplineDto dto = new PricingDisciplineController.DisciplineDto();
        dto.maxAllowedDiscount = 25;
        Test.startTest();
        PricingDisciplineController.populateDtoFromRows(dto, rows);
        Test.stopTest();
        System.assertEquals(6, dto.quoteLineCount);
        System.assertEquals(19.2, dto.avgDiscount);
        System.assertEquals(16.7, dto.overridePct);
        System.assertEquals('High', dto.overrideRiskLabel);
        System.assertEquals(50.0, dto.beyondLimitPct);
        // Both A (≥2 lines, 30% avg) and B (≥2 lines, 10% avg) qualify; A first by avg desc
        System.assertEquals(2, dto.topDiscountOffenders.size());
        System.assertEquals('Widget A', dto.topDiscountOffenders[0].productName);
        System.assertEquals(1, dto.topOverrideOffenders.size());
    }

    @isTest
    static void populateDtoFromRowsHandlesEmpty() {
        PricingDisciplineController.DisciplineDto dto = new PricingDisciplineController.DisciplineDto();
        PricingDisciplineController.populateDtoFromRows(dto, new List<Map<String, Object>>());
        System.assertEquals(0, dto.quoteLineCount);
    }

    @isTest
    static void populateDtoLowAndMediumOverrideTiers() {
        Id pA = UserInfo.getUserId();
        List<Map<String, Object>> low = new List<Map<String, Object>>{
            new Map<String, Object>{ 'discount' => 5, 'pricingMethod' => 'List', 'productId' => pA, 'productName' => 'X' }
        };
        PricingDisciplineController.DisciplineDto dLow = new PricingDisciplineController.DisciplineDto();
        PricingDisciplineController.populateDtoFromRows(dLow, low);
        System.assertEquals('Low', dLow.overrideRiskLabel);

        List<Map<String, Object>> med = new List<Map<String, Object>>();
        for (Integer i = 0; i < 18; i++) {
            med.add(new Map<String, Object>{ 'discount' => 5, 'pricingMethod' => 'List', 'productId' => pA, 'productName' => 'X' });
        }
        med.add(new Map<String, Object>{ 'discount' => 5, 'pricingMethod' => 'Manual', 'productId' => pA, 'productName' => 'X' });
        med.add(new Map<String, Object>{ 'discount' => 5, 'pricingMethod' => 'Manual', 'productId' => pA, 'productName' => 'X' });
        PricingDisciplineController.DisciplineDto dMed = new PricingDisciplineController.DisciplineDto();
        PricingDisciplineController.populateDtoFromRows(dMed, med);
        System.assertEquals('Medium', dMed.overrideRiskLabel);
    }

    @isTest
    static void comparatorsSortDesc() {
        PricingDisciplineController.TopOffender a = new PricingDisciplineController.TopOffender();
        a.avgDiscount = 10; a.overrideCount = 1;
        PricingDisciplineController.TopOffender b = new PricingDisciplineController.TopOffender();
        b.avgDiscount = 20; b.overrideCount = 5;
        PricingDisciplineController.TopOffenderAvgComparator avgC =
            new PricingDisciplineController.TopOffenderAvgComparator();
        System.assertEquals(1, avgC.compare(a, b), 'Bigger avg comes first');
        System.assertEquals(-1, avgC.compare(b, a));
        System.assertEquals(0, avgC.compare(a, a));
        PricingDisciplineController.TopOffenderOverrideComparator ovrC =
            new PricingDisciplineController.TopOffenderOverrideComparator();
        System.assert(ovrC.compare(a, b) > 0, 'Bigger override count comes first');
    }
}
