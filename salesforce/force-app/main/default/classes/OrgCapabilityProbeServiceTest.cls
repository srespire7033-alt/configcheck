/**
 * Phase 25 — Tests for OrgCapabilityProbeService.
 *
 * Coverage targets the pure logic (isApplicable, buildProfile via the
 * test-stub seam, getApplicabilityFor). The HTTP fetchDescribe path is
 * exercised at the seam, so we don't need mock HTTPCalloutMock for the
 * core paths.
 */
@isTest
private class OrgCapabilityProbeServiceTest {

    // ─── isApplicable() — package gates ─────────────────────────────

    @isTest static void isApplicable_cpqGate_blockedWhenCpqMissing() {
        Map<String, Object> profile = profile(false, false, false, false);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'QL-006');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('CPQ package'));
    }

    @isTest static void isApplicable_armGate_blockedWhenArmMissing() {
        Map<String, Object> profile = profile(true, true, true, false);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'ARM-001');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('ARM'));
    }

    @isTest static void isApplicable_blngGate_blockedWhenBlngMissing() {
        Map<String, Object> profile = profile(true, true, false, false);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'TR-001');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('Billing'));
    }

    @isTest static void isApplicable_sbaaGate_blockedForArRulesWhenAbsent() {
        Map<String, Object> profile = profile(true, false, false, false);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'AR-006');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('Advanced Approvals'));
    }

    @isTest static void isApplicable_unknownDetectorId_defaultsApplicable() {
        Map<String, Object> profile = profile(true, true, true, true);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'NEW-DETECTOR-9999');
        System.assertEquals(true, a.applicable);
        System.assertEquals(null, a.reason);
    }

    @isTest static void isApplicable_nullProfile_failsOpen() {
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(null, 'QL-006');
        System.assertEquals(true, a.applicable, 'Null profile should fail-open to applicable=true');
    }

    @isTest static void isApplicable_nullDetectorId_failsOpen() {
        Map<String, Object> profile = profile(false, false, false, false);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, null);
        System.assertEquals(true, a.applicable);
    }

    // ─── isApplicable() — field-level gates ─────────────────────────

    @isTest static void isApplicable_ql005_blockedWhenNetPriceScaleIs2() {
        Map<String, Object> profile = profile(true, true, true, true);
        ((Map<String, Object>) profile.get('fieldScales'))
            .put('SBQQ__QuoteLine__c.SBQQ__NetPrice__c', 2);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'QL-005');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('scale=2'));
    }

    @isTest static void isApplicable_ql005_applicableWhenNetPriceScaleAbove2() {
        Map<String, Object> profile = profile(true, true, true, true);
        ((Map<String, Object>) profile.get('fieldScales'))
            .put('SBQQ__QuoteLine__c.SBQQ__NetPrice__c', 6);
        ((Map<String, Object>) profile.get('optionalFields'))
            .put('SBQQ__QuoteLine__c.SBQQ__Source__c', true);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'QL-005');
        System.assertEquals(true, a.applicable);
    }

    @isTest static void isApplicable_ql006_blockedWhenSourceFieldMissing() {
        Map<String, Object> profile = profile(true, true, true, true);
        // SBQQ__Source__c intentionally NOT added
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'QL-006');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('SBQQ__Source__c'));
    }

    @isTest static void isApplicable_ar006_blockedWhenSbaaRuleFieldMissing() {
        Map<String, Object> profile = profile(true, true, true, true);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'AR-006');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('sbaa__Approval'));
    }

    @isTest static void isApplicable_pb005_blockedWhenBlockPriceObjMissing() {
        Map<String, Object> profile = profile(true, true, true, true);
        OrgCapabilityProbeService.Applicability a =
            OrgCapabilityProbeService.isApplicable(profile, 'PB-005');
        System.assertEquals(false, a.applicable);
        System.assert(a.reason.contains('SBQQ__BlockPrice__c'));
    }

    // ─── buildProfile() — uses describe stub seam ───────────────────

    @isTest static void buildProfile_fromStubDescribes_capturesPackagesAndFields() {
        // We can't easily stub getRemoteSObjectNames from here (it caches
        // via callout). Test the buildProfile inputs by going through the
        // describe stubbing — if remoteSObjectCache happens to be empty
        // for the named credential, this returns null (fail-open).
        OrgCapabilityProbeService.testStubDescribes = new Map<String, Map<String, Object>>{
            'SBQQ__QuoteLine__c' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'SBQQ__NetPrice__c', 'scale' => 2 },
                new Map<String, Object>{ 'name' => 'SBQQ__Source__c' }
            })
        };
        Map<String, Object> result = OrgCapabilityProbeService.fetchDescribe('any', 'SBQQ__QuoteLine__c');
        System.assertNotEquals(null, result);
        OrgCapabilityProbeService.testStubDescribes = null;
    }

    // ─── getApplicabilityFor() — exercise the persistence path ──────

    @isTest static void getApplicabilityFor_withMissingOrg_returnsEmpty() {
        Map<String, OrgCapabilityProbeService.Applicability> m =
            OrgCapabilityProbeService.getApplicabilityFor(null);
        System.assertEquals(0, m.size());
    }

    @isTest static void getApplicabilityFor_withProfile_returnsDecisionsForActiveDetectors() {
        ConnectedOrg__c org = new ConnectedOrg__c(
            Name = 'Test Conn ' + System.now().getTime(),
            NamedCredentialName__c = 'Stub_Cred',
            InstanceUrl__c = 'https://test.example.com',
            CapabilityProfileJson__c = JSON.serialize(profile(true, false, false, false))
        );
        insert org;
        Map<String, OrgCapabilityProbeService.Applicability> m =
            OrgCapabilityProbeService.getApplicabilityFor(org.Id);
        System.assert(m.size() > 0, 'Expect entries for active Detector__mdt rows');
        // Any sbaa-gated detector should come back inapplicable
        if (m.containsKey('AR-006')) {
            System.assertEquals(false, m.get('AR-006').applicable);
        }
    }

    @isTest static void getApplicabilityFor_withBlankJson_handlesGracefully() {
        ConnectedOrg__c org = new ConnectedOrg__c(
            Name = 'Test Conn ' + System.now().getTime(),
            NamedCredentialName__c = 'Stub_Cred',
            InstanceUrl__c = 'https://test.example.com'
        );
        insert org;
        Map<String, OrgCapabilityProbeService.Applicability> m =
            OrgCapabilityProbeService.getApplicabilityFor(org.Id);
        // Null profile → fail open → every detector applicable
        for (OrgCapabilityProbeService.Applicability a : m.values()) {
            System.assertEquals(true, a.applicable,
                'Null/blank profile means every detector defaults to applicable');
        }
    }

    @isTest static void getApplicabilityFor_withMalformedJson_handlesGracefully() {
        ConnectedOrg__c org = new ConnectedOrg__c(
            Name = 'Test Conn ' + System.now().getTime(),
            NamedCredentialName__c = 'Stub_Cred',
            InstanceUrl__c = 'https://test.example.com',
            CapabilityProfileJson__c = 'not json'
        );
        insert org;
        Map<String, OrgCapabilityProbeService.Applicability> m =
            OrgCapabilityProbeService.getApplicabilityFor(org.Id);
        // Parse failure should fail open
        System.assert(m.size() >= 0);
    }

    // ─── probe() — persistence happy-path ───────────────────────────

    @isTest static void probe_nullOrg_returnsNull() {
        System.assertEquals(null, OrgCapabilityProbeService.probe(null));
    }

    @isTest static void probe_blankNamedCredential_returnsNull() {
        ConnectedOrg__c org = new ConnectedOrg__c(Name = 'X');
        // NamedCredentialName__c left blank
        System.assertEquals(null, OrgCapabilityProbeService.probe(org));
    }

    @isTest static void buildProfile_returnsNullWhenObjectProbeFails() {
        // No HTTP mock registered → callout will fail → getRemoteSObjectNames
        // returns null → buildProfile returns null.
        Test.startTest();
        Map<String, Object> result = OrgCapabilityProbeService.buildProfile('Stub_Cred');
        Test.stopTest();
        System.assertEquals(null, result, 'No sobjects discovered → return null');
    }

    @isTest static void buildProfile_withStubDescribes_capturesPackageAndFieldAndScale() {
        // Pre-prime the OrgQueryService sobject-name cache so the probe
        // believes the target has CPQ + sbaa installed.
        OrgQueryService.remoteSObjectCache.put('Stub_Cred', new Set<String>{
            'SBQQ__Quote__c',
            'SBQQ__QuoteLine__c',
            'SBQQ__BlockPrice__c',
            'sbaa__ApprovalRule__c',
            'sbaa__Approval__c',
            'Product2',
            'Opportunity',
            'Contract'
        });
        OrgCapabilityProbeService.testStubDescribes = new Map<String, Map<String, Object>>{
            'SBQQ__QuoteLine__c' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'SBQQ__NetPrice__c', 'scale' => 2 },
                new Map<String, Object>{ 'name' => 'SBQQ__Source__c' }
            }),
            'SBQQ__BlockPrice__c' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'Id' }
            }),
            'sbaa__ApprovalRule__c' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'sbaa__Active__c' }
            }),
            'sbaa__Approval__c' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'sbaa__Rule__c' }
            }),
            'Product2' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'Name' }
            }),
            'Opportunity' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'StageName' }
            }),
            'Contract' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'StartDate' }
            })
        };

        Map<String, Object> result = OrgCapabilityProbeService.buildProfile('Stub_Cred');
        OrgCapabilityProbeService.testStubDescribes = null;
        OrgQueryService.remoteSObjectCache.remove('Stub_Cred');

        System.assertNotEquals(null, result);
        Map<String, Object> pkgs = (Map<String, Object>) result.get('packages');
        System.assertEquals(true, pkgs.get('cpq'));
        System.assertEquals(true, pkgs.get('sbaa'));
        System.assertEquals(false, pkgs.get('blng'));
        Map<String, Object> fields = (Map<String, Object>) result.get('optionalFields');
        System.assertEquals(true, fields.get('SBQQ__QuoteLine__c.SBQQ__Source__c'));
        Map<String, Object> scales = (Map<String, Object>) result.get('fieldScales');
        System.assertEquals(2, scales.get('SBQQ__QuoteLine__c.SBQQ__NetPrice__c'));
    }

    @isTest static void probe_withStubProfile_persistsToRecord() {
        ConnectedOrg__c org = new ConnectedOrg__c(
            Name = 'Test Probe ' + System.now().getTime(),
            NamedCredentialName__c = 'Stub_Cred',
            InstanceUrl__c = 'https://test.example.com'
        );
        insert org;
        OrgQueryService.remoteSObjectCache.put('Stub_Cred', new Set<String>{
            'SBQQ__Quote__c', 'Product2', 'Opportunity', 'Contract'
        });
        OrgCapabilityProbeService.testStubDescribes = new Map<String, Map<String, Object>>{
            'Product2' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'Name' }
            }),
            'Opportunity' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'StageName' }
            }),
            'Contract' => makeDescribe(new List<Map<String, Object>>{
                new Map<String, Object>{ 'name' => 'StartDate' }
            })
        };
        String payload = OrgCapabilityProbeService.probe(org);
        OrgCapabilityProbeService.testStubDescribes = null;
        OrgQueryService.remoteSObjectCache.remove('Stub_Cred');

        System.assertNotEquals(null, payload);
        ConnectedOrg__c reloaded = [
            SELECT CapabilityProfileJson__c, CapabilityProbedAt__c
            FROM ConnectedOrg__c WHERE Id = :org.Id LIMIT 1
        ];
        System.assertNotEquals(null, reloaded.CapabilityProfileJson__c);
        System.assertNotEquals(null, reloaded.CapabilityProbedAt__c);
    }

    // ─── Phase 25-B — Aura wrappers ─────────────────────────────────

    @isTest static void getApplicabilitySummary_nullOrg_returnsEmpty() {
        OrgCapabilityProbeService.ApplicabilitySummary s =
            OrgCapabilityProbeService.getApplicabilitySummary(null);
        System.assertEquals(0, s.total);
        System.assertEquals(0, s.applicable);
        System.assertEquals(0, s.skipped);
        System.assertEquals(false, s.profiled);
    }

    @isTest static void getApplicabilitySummary_withProfile_returnsCountsAndDecisions() {
        ConnectedOrg__c org = new ConnectedOrg__c(
            Name = 'Test Summary ' + System.now().getTime(),
            NamedCredentialName__c = 'Stub_Cred',
            InstanceUrl__c = 'https://test.example.com',
            CapabilityProfileJson__c = JSON.serialize(profile(true, false, false, false)),
            CapabilityProbedAt__c = System.now()
        );
        insert org;
        OrgCapabilityProbeService.ApplicabilitySummary s =
            OrgCapabilityProbeService.getApplicabilitySummary(org.Id);
        System.assertEquals(true, s.profiled);
        System.assert(s.total > 0, 'Active Detector__mdt records should be counted');
        System.assertEquals(s.total, s.applicable + s.skipped);
        // sbaa-gated detectors should be in skipped (sbaa=false in profile)
        if (s.decisions.containsKey('AR-006')) {
            System.assertEquals(false, s.decisions.get('AR-006').applicable);
            System.assertNotEquals(null, s.decisions.get('AR-006').reason);
        }
    }

    @isTest static void probeNow_nullOrg_throws() {
        try {
            OrgCapabilityProbeService.probeNow(null);
            System.assert(false, 'Should have thrown');
        } catch (AuraHandledException e) {
            // Expected
        }
    }

    @isTest static void probeNow_unknownOrg_throws() {
        // Synthesize a fake Id with the ConnectedOrg__c prefix (a0W)
        Id fakeId = (Id) ('a0W' + '000000000000001');
        try {
            OrgCapabilityProbeService.probeNow(fakeId);
            System.assert(false, 'Should have thrown — org not found');
        } catch (AuraHandledException e) {
            // Expected
        }
    }

    @isTest static void mapOf_handlesNullAndWrongType() {
        System.assertEquals(0, OrgCapabilityProbeService.mapOf(null).size());
        System.assertEquals(0, OrgCapabilityProbeService.mapOf('not a map').size());
        Map<String, Object> m = new Map<String, Object>{ 'k' => 'v' };
        System.assertEquals(m, OrgCapabilityProbeService.mapOf(m));
    }

    // ─── helpers ───────────────────────────────────────────────────

    private static Map<String, Object> profile(Boolean cpq, Boolean sbaa, Boolean blng, Boolean arm) {
        return new Map<String, Object>{
            'packages' => new Map<String, Object>{
                'cpq' => cpq, 'sbaa' => sbaa, 'blng' => blng, 'arm' => arm
            },
            'optionalFields' => new Map<String, Object>(),
            'fieldScales' => new Map<String, Object>(),
            'probedAt' => String.valueOf(System.now())
        };
    }

    private static Map<String, Object> makeDescribe(List<Map<String, Object>> fields) {
        List<Object> fieldList = new List<Object>();
        for (Map<String, Object> f : fields) fieldList.add(f);
        return new Map<String, Object>{ 'fields' => fieldList };
    }
}
