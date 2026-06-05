@isTest
private class OrgComplexityControllerTest {

    @isTest
    static void returnsDtoWithEightFactors() {
        Test.startTest();
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity();
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
        OrgComplexityController.ComplexityDto dto = OrgComplexityController.getComplexity();
        Test.stopTest();
        for (OrgComplexityController.Factor f : dto.factors) {
            System.assertNotEquals(null, f.label);
            System.assertNotEquals(null, f.weight);
            System.assert(f.count >= 0);
            System.assert(f.benchmark > 0, 'Every factor has a positive benchmark');
            System.assert(f.contribution >= 0);
        }
    }
}
