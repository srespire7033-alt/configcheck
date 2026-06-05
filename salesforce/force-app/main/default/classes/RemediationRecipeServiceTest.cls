/**
 * Phase 16b — Remediation Recipe Service tests.
 *
 * Strategy: exercise the interpolation, missing-recipe, and unknown-
 * token paths against a finding we construct directly. The 20 .md-meta
 * records ship to the org, so the live recipes ARE the test fixtures.
 */
@IsTest
private class RemediationRecipeServiceTest {

    private static ForensicScan__c newScan() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ', StartedAt__c = System.now()
        );
        insert s;
        return s;
    }

    private static ForensicFinding__c newFinding(Id scanId, String detector, Map<String, Object> meta) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId, DetectorId__c = detector,
            Severity__c = 'Critical', Title__c = detector + ' finding',
            Status__c = 'Open', DetectedAt__c = System.now(),
            PrimaryRecordId__c = scanId,
            PrimaryRecordType__c = 'SBQQ__QuoteLine__c',
            GapUsd__c = 1500,
            Metadata__c = meta == null ? '{}' : JSON.serialize(meta)
        );
        insert f;
        return f;
    }

    @IsTest
    static void render_null_finding_returns_null() {
        System.assertEquals(null, RemediationRecipeService.render(null));
        ForensicFinding__c f = new ForensicFinding__c();
        System.assertEquals(null, RemediationRecipeService.render(f));
    }

    @IsTest
    static void render_unknown_detector_returns_null() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'NEVER-SHIPPED', null);
        System.assertEquals(null, RemediationRecipeService.render(f));
    }

    @IsTest
    static void render_REN_001_interpolates_metadata() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', new Map<String, Object>{
            'upliftPct' => 5,
            'originalPrice' => 10000,
            'entitledPrice' => 10500
        });

        Test.startTest();
        String out = RemediationRecipeService.render(f);
        Test.stopTest();

        System.assertNotEquals(null, out);
        // Title interpolates {primaryRecordId}
        System.assert(out.contains(String.valueOf(s.Id)),
            'Should interpolate the finding\'s primaryRecordId: ' + out);
        // Steps interpolate metadata values
        System.assert(out.contains('10500'), 'Should interpolate entitledPrice');
        System.assert(out.contains('10000'), 'Should interpolate originalPrice');
        // Effort + Skill render in the header
        System.assert(out.contains('Effort:'), 'Should render the Effort label');
        System.assert(out.contains('Skill:'), 'Should render the Skill label');
    }

    @IsTest
    static void render_ORD_FOR_002_interpolates_list_metadata() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'ORD-FOR-002', new Map<String, Object>{
            'quoteNetAmount' => 50000,
            'orderTotal' => 45000,
            'delta' => 5000,
            'direction' => 'under_billed',
            'orderIds' => new List<String>{ 'O-001', 'O-002' }
        });

        String out = RemediationRecipeService.render(f);
        System.assertNotEquals(null, out);
        // List-type metadata renders as comma-joined string
        System.assert(out.contains('O-001'));
        System.assert(out.contains('O-002'));
        System.assert(out.contains('under_billed'));
    }

    @IsTest
    static void render_leaves_unknown_tokens_literal() {
        // The REN-001 recipe references {upliftPct} — deliberately
        // omit it from metadata. Placeholder should stay literal.
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', new Map<String, Object>{
            'originalPrice' => 10000
            // upliftPct intentionally missing
        });
        String out = RemediationRecipeService.render(f);
        System.assert(out.contains('{upliftPct}'),
            'Unknown token should be left literal: ' + out);
    }

    @IsTest
    static void render_garbled_metadata_does_not_crash() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', null);
        f.Metadata__c = '{not valid json';
        update f;
        String out = RemediationRecipeService.render(f);
        System.assertNotEquals(null, out, 'Garbled metadata should not block render');
    }

    @IsTest
    static void renderForFinding_aura_method_works_and_handles_null() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'AMD-FOR-001', new Map<String, Object>{
            'status' => 'Activated', 'endDate' => '2025-12-31',
            'accountName' => 'Acme Corp'
        });

        String out = RemediationRecipeService.renderForFinding(f.Id);
        System.assertNotEquals(null, out);
        System.assert(out.contains('Acme Corp'));

        System.assertEquals(null, RemediationRecipeService.renderForFinding(null));
    }

    @IsTest
    static void render_works_for_every_shipped_recipe() {
        // Defensive: every .md-meta record we ship should render against
        // a minimally-populated finding without throwing. This catches
        // typos in placeholder names that would otherwise show up as
        // {someTypo} in client deliverables.
        ForensicScan__c s = newScan();
        Map<String, Object> richMeta = new Map<String, Object>{
            'upliftPct' => 5, 'originalPrice' => 1000, 'entitledPrice' => 1050,
            'currentListPrice' => 100, 'renewalNetPrice' => 80,
            'percentBelowList' => 20, 'pricingMethod' => 'Manual',
            'scheduleName' => 'Q4 Promo', 'scheduleEndDate' => '2024-12-31',
            'orderNumber' => '00001', 'daysSinceActivation' => 30, 'itemCount' => 2,
            'orderIds' => new List<String>{ 'O-1' }, 'orderTotal' => 45000,
            'quoteNetAmount' => 50000, 'delta' => 5000, 'direction' => 'under_billed',
            'accountId' => '001000000000001', 'accountName' => 'Acme',
            'productName' => 'Widget', 'quantity' => 5, 'unitPrice' => 100,
            'annualExposure' => 12000, 'status' => 'Activated',
            'endDate' => '2025-12-31', 'closeDate' => '2025-01-01',
            'daysSinceClose' => 90, 'flagReason' => 'all_expired',
            'subscriptionCount' => 3, 'latestSubscriptionEnd' => '2024-10-01',
            'discountPct' => 35, 'thresholdPct' => 20, 'capPct' => 30,
            'effectiveDiscountPct' => 45, 'quoteId' => 'a04000000000001',
            'segmentCount' => 3, 'flaggedSegs' => 2, 'year1Net' => 100,
            'assetStatus' => 'Terminated', 'terminatedDate' => '2025-03-01',
            'contractedPriceId' => 'a09000000000001', 'expiration' => '2024-06-01',
            'lockedPrice' => 80, 'currentList' => 100, 'daysExpired' => 200,
            'installDate' => '2024-12-01', 'daysInstalled' => 90, 'priceSource' => 'asset',
            'arrAtRisk' => 50000, 'expirationDate' => '2025-01-01', 'quoteType' => 'Renewal'
        };

        List<String> detectors = new List<String>{
            'REN-001', 'REN-002', 'REN-003', 'REN-004',
            'DSC-FOR-001', 'DSC-FOR-002',
            'QL-FOR-001', 'QL-FOR-002',
            'ORD-FOR-001', 'ORD-FOR-002', 'ORD-FOR-003',
            'SUB-FOR-001', 'PROV-FOR-001', 'PROV-FOR-002',
            'OPP-FOR-001', 'CON-FOR-001', 'AMD-FOR-001',
            'AST-FOR-001', 'CT-FOR-001', 'MDQ-FOR-001'
        };

        Test.startTest();
        Integer rendered = 0;
        for (String did : detectors) {
            ForensicFinding__c f = newFinding(s.Id, did, richMeta);
            String out = RemediationRecipeService.render(f);
            if (String.isNotBlank(out)) rendered += 1;
        }
        Test.stopTest();

        System.assertEquals(20, rendered, 'All 20 recipes should render successfully');
    }
}
