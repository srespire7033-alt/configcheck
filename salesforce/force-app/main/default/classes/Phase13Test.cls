/**
 * Phase 13 coverage — bulk re-verify + finding notes.
 *
 * Re-verify tests use the unsupported-detector path (most reliable
 * across CPQ-less scratch orgs) to exercise the dispatch + verdict
 * shape. The CPQ-required verifiers (QL-FOR-001 etc.) are exercised
 * only to confirm they degrade to 'manual' when the SBQQ__ objects
 * are missing — which is the same code path host orgs will hit.
 */
@IsTest
private class Phase13Test {

    private static ForensicScan__c newScan() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        return s;
    }

    private static ForensicFinding__c newFinding(Id scanId, String detector, Id primaryRecordId) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId,
            DetectorId__c = detector,
            Severity__c = 'Critical',
            Title__c = detector + ' finding',
            Status__c = 'Open',
            DetectedAt__c = System.now(),
            PrimaryRecordId__c = primaryRecordId,
            PrimaryRecordType__c = 'Order',
            GapUsd__c = 1000
        );
        insert f;
        return f;
    }

    /** Stage + approve + mark committed in one helper so tests can focus on re-verify. */
    private static Id committedActionFor(ForensicFinding__c f) {
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);
        RecoveryActionService.markCommitted(actionId);
        return actionId;
    }

    // ── FindingNoteService ─────────────────────────────────────────────

    @IsTest
    static void saveNote_persists_and_trims() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', s.Id);

        Test.startTest();
        String saved = FindingNoteService.saveNote(f.Id, '  Customer confirmed.  ');
        Test.stopTest();

        System.assertEquals('Customer confirmed.', saved, 'Should trim whitespace');
        ForensicFinding__c after1 = [SELECT UserNotes__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals('Customer confirmed.', after1.UserNotes__c);
    }

    @IsTest
    static void saveNote_empty_clears_field() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', s.Id);
        f.UserNotes__c = 'existing note';
        update f;

        FindingNoteService.saveNote(f.Id, '   ');
        ForensicFinding__c after1 = [SELECT UserNotes__c FROM ForensicFinding__c WHERE Id = :f.Id];
        System.assertEquals(null, after1.UserNotes__c, 'Blank should clear the field');
    }

    @IsTest
    static void saveNote_null_findingId_throws() {
        try {
            FindingNoteService.saveNote(null, 'anything');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            // expected
        }
    }

    @IsTest
    static void getNote_returns_empty_string_when_unset() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', s.Id);
        System.assertEquals('', FindingNoteService.getNote(f.Id));
    }

    @IsTest
    static void getNote_returns_saved_value() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', s.Id);
        FindingNoteService.saveNote(f.Id, 'Scheduled fix for Q3');
        System.assertEquals('Scheduled fix for Q3', FindingNoteService.getNote(f.Id));
    }

    @IsTest
    static void getNote_null_findingId_returns_empty() {
        System.assertEquals('', FindingNoteService.getNote(null));
    }

    // ── Phase 16c — note suggestion bundle ──

    @IsTest
    static void getNoteBundle_returns_suggestions_for_known_detector() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'REN-001', s.Id);
        FindingNoteService.saveNote(f.Id, 'in-progress');

        Test.startTest();
        FindingNoteService.NoteBundle b = FindingNoteService.getNoteBundle(f.Id);
        Test.stopTest();

        System.assertEquals('in-progress', b.notes);
        // REN-001 has 3 suggestions shipped in the mdt
        System.assertEquals(3, b.suggestions.size(),
            'Expected 3 suggestions for REN-001; got ' + b.suggestions);
    }

    @IsTest
    static void getNoteBundle_unknown_detector_returns_empty_suggestions() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'NOT-A-DETECTOR', s.Id);
        FindingNoteService.NoteBundle b = FindingNoteService.getNoteBundle(f.Id);
        System.assertEquals(0, b.suggestions.size());
    }

    @IsTest
    static void getNoteBundle_null_findingId_safe() {
        FindingNoteService.NoteBundle b = FindingNoteService.getNoteBundle(null);
        System.assertEquals('', b.notes);
        System.assertEquals(0, b.suggestions.size());
    }

    // ── bulkReverify ───────────────────────────────────────────────────

    @IsTest
    static void bulkReverify_empty_list_returns_zero_counts() {
        Map<String, Object> r = RecoveryActionService.bulkReverify(new List<Id>());
        System.assertEquals(0, r.get('requested'));
        System.assertEquals(0, r.get('reverified'));
    }

    @IsTest
    static void bulkReverify_too_many_throws() {
        List<Id> tooMany = new List<Id>();
        // Use the scan Id repeated 201 times — not real action Ids, but the
        // size-check fires before any query, so the values don't matter.
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 201; i++) tooMany.add(s.Id);
        try {
            RecoveryActionService.bulkReverify(tooMany);
            System.assert(false, 'Expected RecoveryException for too many');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('limit'));
        }
    }

    @IsTest
    static void bulkReverify_unknown_detector_returns_manual_verdict() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'XYZ-NEW-DETECTOR', s.Id);
        Id actionId = committedActionFor(f);

        Test.startTest();
        Map<String, Object> r = RecoveryActionService.bulkReverify(new List<Id>{ actionId });
        Test.stopTest();

        System.assertEquals(1, r.get('requested'));
        System.assertEquals(0, r.get('stillResolved'));
        System.assertEquals(0, r.get('regressed'));
        System.assertEquals(1, r.get('skipped'));
        List<Object> verdicts = (List<Object>) r.get('verdicts');
        Map<String, Object> v = (Map<String, Object>) verdicts[0];
        System.assertEquals('manual', v.get('status'));
        System.assert(((String) v.get('message')).contains('No automated verifier'));
    }

    @IsTest
    static void bulkReverify_nonCommitted_action_is_skipped() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'XYZ-DETECTOR', s.Id);
        Id actionId = RecoveryActionService.stageFinding(f.Id); // Pending

        Map<String, Object> r = RecoveryActionService.bulkReverify(new List<Id>{ actionId });
        System.assertEquals(1, r.get('skipped'));
        List<Object> verdicts = (List<Object>) r.get('verdicts');
        Map<String, Object> v = (Map<String, Object>) verdicts[0];
        System.assertEquals('skipped', v.get('status'));
    }

    @IsTest
    static void bulkReverify_CPQ_detectors_degrade_to_manual_when_no_CPQ() {
        // The host org under test won't have SBQQ__/blng__ objects, so
        // each CPQ-bound verifier should catch + return 'manual' rather
        // than throwing.
        ForensicScan__c s = newScan();
        List<Id> actions = new List<Id>();
        for (String did : new List<String>{
            'ORD-FOR-001', 'QL-FOR-001', 'DSC-FOR-001',
            'AMD-FOR-001', 'CT-FOR-001'
        }) {
            ForensicFinding__c f = newFinding(s.Id, did, s.Id);
            actions.add(committedActionFor(f));
        }

        Test.startTest();
        Map<String, Object> r = RecoveryActionService.bulkReverify(actions);
        Test.stopTest();

        // All 5 should be skipped (manual) in a non-CPQ org.
        System.assertEquals(5, r.get('requested'));
        System.assertEquals(5, r.get('skipped'),
            'Expected all 5 CPQ detectors to degrade to manual in non-CPQ org');
    }

    @IsTest
    static void reverify_single_action_returns_one_verdict() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'XYZ-DETECTOR', s.Id);
        Id actionId = committedActionFor(f);

        Map<String, Object> r = RecoveryActionService.reverify(actionId);
        System.assertNotEquals(null, r.get('verdict'));
        Map<String, Object> v = (Map<String, Object>) r.get('verdict');
        System.assertEquals('manual', v.get('status'));
    }

    // ── Phase 14a — markCommitted auto-verifies in the same txn ──

    @IsTest
    static void markCommitted_returns_verdict_for_known_detector() {
        Account acct = new Account(Name = 'AV Test Co');
        insert acct;
        Contract c = new Contract(
            AccountId = acct.Id, Status = 'Draft',
            StartDate = Date.today(), ContractTerm = 12
        );
        insert c;

        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'CON-FOR-001', c.Id);
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);

        Test.startTest();
        Map<String, Object> result = RecoveryActionService.markCommitted(actionId);
        Test.stopTest();

        // Contract is Draft → CON-FOR-001 verifier returns 'verified'
        // because the contract is no longer Activated.
        Map<String, Object> verdict = (Map<String, Object>) result.get('verdict');
        System.assertNotEquals(null, verdict,
            'markCommitted should return a verdict for known detectors');
        System.assertEquals('verified', verdict.get('status'));

        RecoveryAction__c after1 = [
            SELECT ApprovalStatus__c, CommitVerified__c, VerificationMessage__c, CommittedAt__c
            FROM RecoveryAction__c WHERE Id = :actionId
        ];
        System.assertEquals('Committed', after1.ApprovalStatus__c);
        System.assertEquals(true, after1.CommitVerified__c,
            'Auto-verify should have flipped CommitVerified__c to true');
        System.assertNotEquals(null, after1.CommittedAt__c);
        System.assert(after1.VerificationMessage__c.contains('no longer Activated'));
    }

    @IsTest
    static void markCommitted_unknown_detector_still_commits_with_manual_verdict() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'XYZ-NEW-DETECTOR', s.Id);
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);

        Map<String, Object> result = RecoveryActionService.markCommitted(actionId);

        // State transition succeeds even when verifier can't help.
        RecoveryAction__c after1 = [SELECT ApprovalStatus__c, CommitVerified__c
                                   FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Committed', after1.ApprovalStatus__c);

        Map<String, Object> verdict = (Map<String, Object>) result.get('verdict');
        System.assertEquals('manual', verdict.get('status'));
        // CommitVerified__c stays at its default (false) — auto-verify
        // gave a 'manual' verdict, which doesn't touch the field.
        System.assertEquals(false, after1.CommitVerified__c);
    }

    // ── Phase 14c — bulk approve / bulk commit ──

    @IsTest
    static void bulkApprove_transitions_pending_skips_others() {
        ForensicScan__c s = newScan();
        ForensicFinding__c f1 = newFinding(s.Id, 'XYZ-1', s.Id);
        ForensicFinding__c f2 = newFinding(s.Id, 'XYZ-2', s.Id);
        Id a1 = RecoveryActionService.stageFinding(f1.Id);   // Pending
        Id a2 = RecoveryActionService.stageFinding(f2.Id);
        RecoveryActionService.approve(a2);                    // Approved — should be skipped

        Test.startTest();
        Map<String, Object> r = RecoveryActionService.bulkApprove(new List<Id>{ a1, a2 });
        Test.stopTest();

        System.assertEquals(2, r.get('requested'));
        System.assertEquals(1, r.get('transitioned'), 'Only the Pending one should transition');
        System.assertEquals(1, r.get('skipped'));
        RecoveryAction__c after1 = [SELECT ApprovalStatus__c FROM RecoveryAction__c WHERE Id = :a1];
        System.assertEquals('Approved', after1.ApprovalStatus__c);
    }

    @IsTest
    static void bulkMarkCommitted_auto_verifies_each_action() {
        Account acct = new Account(Name = 'Bulk Test Co');
        insert acct;
        Contract c = new Contract(
            AccountId = acct.Id, Status = 'Draft',
            StartDate = Date.today(), ContractTerm = 12
        );
        insert c;

        ForensicScan__c s = newScan();
        ForensicFinding__c f1 = newFinding(s.Id, 'CON-FOR-001', c.Id);
        ForensicFinding__c f2 = newFinding(s.Id, 'UNKNOWN-DETECTOR', s.Id);
        Id a1 = RecoveryActionService.stageFinding(f1.Id);
        Id a2 = RecoveryActionService.stageFinding(f2.Id);
        RecoveryActionService.approve(a1);
        RecoveryActionService.approve(a2);

        Test.startTest();
        Map<String, Object> r = RecoveryActionService.bulkMarkCommitted(new List<Id>{ a1, a2 });
        Test.stopTest();

        System.assertEquals(2, r.get('transitioned'));
        List<Object> verdicts = (List<Object>) r.get('verdicts');
        // Verdicts should include one 'verified' (CON-FOR-001) and one 'manual'.
        Boolean sawVerified = false;
        Boolean sawManual = false;
        for (Object o : verdicts) {
            Map<String, Object> v = (Map<String, Object>) o;
            if (v.get('status') == 'verified') sawVerified = true;
            if (v.get('status') == 'manual') sawManual = true;
        }
        System.assert(sawVerified, 'Expected at least one verified verdict');
        System.assert(sawManual, 'Expected at least one manual verdict');

        // Both actions in Committed; the CON-FOR-001 one has CommitVerified__c=true.
        Map<Id, RecoveryAction__c> after1 = new Map<Id, RecoveryAction__c>([
            SELECT Id, ApprovalStatus__c, CommitVerified__c
            FROM RecoveryAction__c WHERE Id IN :new List<Id>{ a1, a2 }
        ]);
        System.assertEquals('Committed', after1.get(a1).ApprovalStatus__c);
        System.assertEquals('Committed', after1.get(a2).ApprovalStatus__c);
        System.assertEquals(true, after1.get(a1).CommitVerified__c);
    }

    @IsTest
    static void bulkApprove_empty_list_returns_zero() {
        Map<String, Object> r = RecoveryActionService.bulkApprove(new List<Id>());
        System.assertEquals(0, r.get('requested'));
        System.assertEquals(0, r.get('transitioned'));
    }

    @IsTest
    static void bulkApprove_too_many_throws() {
        List<Id> tooMany = new List<Id>();
        ForensicScan__c s = newScan();
        for (Integer i = 0; i < 201; i++) tooMany.add(s.Id);
        try {
            RecoveryActionService.bulkApprove(tooMany);
            System.assert(false, 'Expected RecoveryException');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('limit'));
        }
    }

    @IsTest
    static void bulkReverify_CON_FOR_001_uses_real_Contract_query() {
        // CON-FOR-001's verifier queries standard Contract — works in any
        // org. Set up an Activated contract; the verifier should NOT
        // mark it verified because Status is still Activated AND we
        // can't query SBQQ__Subscription__c, so it should degrade to
        // 'manual'. Either way, the code path is exercised.
        Account acct = new Account(Name = 'Test Co');
        insert acct;
        Contract c = new Contract(
            AccountId = acct.Id, Status = 'Draft',
            StartDate = Date.today(),
            ContractTerm = 12
        );
        insert c;

        ForensicScan__c s = newScan();
        ForensicFinding__c f = newFinding(s.Id, 'CON-FOR-001', c.Id);
        Id actionId = committedActionFor(f);

        Test.startTest();
        Map<String, Object> r = RecoveryActionService.bulkReverify(new List<Id>{ actionId });
        Test.stopTest();

        // Contract is Draft (not Activated) → verifier should mark verified.
        System.assertEquals(1, r.get('stillResolved'),
            'Draft contract should be marked verified — Status != Activated');
        RecoveryAction__c after1 = [SELECT CommitVerified__c, VerificationMessage__c
                                   FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals(true, after1.CommitVerified__c);
        System.assert(after1.VerificationMessage__c.contains('no longer Activated'),
            'Got: ' + after1.VerificationMessage__c);
    }
}
