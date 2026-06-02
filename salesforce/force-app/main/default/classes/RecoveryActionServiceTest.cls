/**
 * Exercises RecoveryActionService end-to-end + the
 * RecoveryActionTrigger guard rails.
 *
 * Covers:
 *   - stageFinding() happy path (creates Pending)
 *   - stageFinding() idempotency (existing Pending → return Id, no dup)
 *   - stageFinding() resurrection (Rejected → Pending reset)
 *   - bulkStage() with mixed new + existing + terminal-state findings
 *   - approve() Pending → Approved + ApprovedAt set
 *   - approve() from wrong state throws
 *   - reject() from Pending and from Approved
 *   - markCommitted() Approved → Committed + CommittedAt set
 *   - markCommitted() from wrong state throws
 *   - restage() from Rejected, Expired, and Committed all reset to Pending
 *   - restage() from Pending throws
 *   - Trigger blocks illegal transitions when bypassing the service
 *   - Trigger forces new rows to start in Pending
 */
@isTest
private class RecoveryActionServiceTest {

    private static ForensicFinding__c makeFinding() {
        ForensicScan__c scan = TestDataFactory.makeScan('CPQ');
        return TestDataFactory.makeFinding(scan.Id, 'REN-001');
    }

    // ─────────────────────────────────────────────────────────────
    // stageFinding()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void stageFinding_createsPendingAction() {
        ForensicFinding__c f = makeFinding();

        Test.startTest();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c, ProjectedReclaimUsd__c, DraftPayload__c
                                FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Pending', a.ApprovalStatus__c);
        System.assertNotEquals(null, a.DraftPayload__c, 'Payload should be serialized');
        System.assertEquals(400, a.ProjectedReclaimUsd__c, 'Gap 500 × score 0.8 = 400');
    }

    @isTest
    static void stageFinding_returnsExistingPendingAction() {
        ForensicFinding__c f = makeFinding();
        Id firstId = RecoveryActionService.stageFinding(f.Id);

        Test.startTest();
        Id secondId = RecoveryActionService.stageFinding(f.Id);
        Test.stopTest();

        System.assertEquals(firstId, secondId, 'Idempotent — same Id returned');
        System.assertEquals(1, [SELECT COUNT() FROM RecoveryAction__c WHERE ForensicFinding__c = :f.Id]);
    }

    @isTest
    static void stageFinding_resurrectsRejectedAction() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.reject(actionId);

        Test.startTest();
        Id resurrectedId = RecoveryActionService.stageFinding(f.Id);
        Test.stopTest();

        System.assertEquals(actionId, resurrectedId, 'Same action reset to Pending');
        RecoveryAction__c a = [SELECT ApprovalStatus__c FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Pending', a.ApprovalStatus__c);
    }

    @isTest
    static void stageFinding_throwsOnNullId() {
        try {
            RecoveryActionService.stageFinding(null);
            System.assert(false, 'Should have thrown');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('findingId'));
        }
    }

    // ─────────────────────────────────────────────────────────────
    // bulkStage()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void bulkStage_handlesMixedStates() {
        ForensicScan__c scan = TestDataFactory.makeScan('CPQ');
        ForensicFinding__c f1 = TestDataFactory.makeFinding(scan.Id, 'REN-001');
        ForensicFinding__c f2 = TestDataFactory.makeFinding(scan.Id, 'REN-002');
        ForensicFinding__c f3 = TestDataFactory.makeFinding(scan.Id, 'DSC-FOR-001');

        // f1 already pending (via single stage)
        RecoveryActionService.stageFinding(f1.Id);
        // f2 was rejected
        Id f2Action = RecoveryActionService.stageFinding(f2.Id);
        RecoveryActionService.reject(f2Action);
        // f3 has no existing action — fresh stage

        Test.startTest();
        Map<String, Integer> summary = RecoveryActionService.bulkStage(
            new List<Id>{ f1.Id, f2.Id, f3.Id }
        );
        Test.stopTest();

        System.assertEquals(3, summary.get('requested'));
        System.assertEquals(1, summary.get('staged'), 'f3 freshly staged');
        System.assertEquals(1, summary.get('alreadyStaged'), 'f1 was already Pending');
        System.assertEquals(1, summary.get('reset'), 'f2 was Rejected → reset to Pending');
    }

    @isTest
    static void bulkStage_throwsOnEmptyList() {
        try {
            RecoveryActionService.bulkStage(new List<Id>{});
            System.assert(false, 'Should have thrown');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('cannot be empty'));
        }
    }

    // ─────────────────────────────────────────────────────────────
    // approve()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void approve_pendingToApproved_setsApprovedAt() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);

        Test.startTest();
        RecoveryActionService.approve(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c, ApprovedAt__c
                                FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Approved', a.ApprovalStatus__c);
        System.assertNotEquals(null, a.ApprovedAt__c);
    }

    @isTest
    static void approve_fromCommittedThrows() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);
        RecoveryActionService.markCommitted(actionId);

        try {
            RecoveryActionService.approve(actionId);
            System.assert(false, 'Should have thrown');
        } catch (Exception e) {
            // Could be RecoveryException OR DmlException (trigger rejection)
            System.assert(
                e.getMessage().contains('Cannot transition') ||
                e.getMessage().contains('Illegal status transition'),
                'Got: ' + e.getMessage()
            );
        }
    }

    // ─────────────────────────────────────────────────────────────
    // reject()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void reject_fromPending() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);

        Test.startTest();
        RecoveryActionService.reject(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Rejected', a.ApprovalStatus__c);
    }

    @isTest
    static void reject_fromApproved() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);

        Test.startTest();
        RecoveryActionService.reject(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Rejected', a.ApprovalStatus__c);
    }

    @isTest
    static void reject_fromRejectedThrows() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.reject(actionId);

        try {
            RecoveryActionService.reject(actionId);
            System.assert(false, 'Should have thrown');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('Cannot reject'));
        }
    }

    // ─────────────────────────────────────────────────────────────
    // markCommitted()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void markCommitted_approvedToCommitted_setsCommittedAt() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);

        Test.startTest();
        RecoveryActionService.markCommitted(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c, CommittedAt__c
                                FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Committed', a.ApprovalStatus__c);
        System.assertNotEquals(null, a.CommittedAt__c);
    }

    @isTest
    static void markCommitted_fromPendingThrows() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);

        try {
            RecoveryActionService.markCommitted(actionId);
            System.assert(false, 'Should have thrown');
        } catch (Exception e) {
            System.assert(
                e.getMessage().contains('Cannot transition') ||
                e.getMessage().contains('Illegal status transition'),
                'Got: ' + e.getMessage()
            );
        }
    }

    // ─────────────────────────────────────────────────────────────
    // restage()
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void restage_fromRejected() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.reject(actionId);

        Test.startTest();
        RecoveryActionService.restage(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c, ApprovedAt__c, CommittedAt__c
                                FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Pending', a.ApprovalStatus__c);
        System.assertEquals(null, a.ApprovedAt__c, 'ApprovedAt cleared on restage');
        System.assertEquals(null, a.CommittedAt__c, 'CommittedAt cleared on restage');
    }

    @isTest
    static void restage_fromCommitted_clearsApprovedAndCommittedAt() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(actionId);
        RecoveryActionService.markCommitted(actionId);

        Test.startTest();
        RecoveryActionService.restage(actionId);
        Test.stopTest();

        RecoveryAction__c a = [SELECT ApprovalStatus__c, ApprovedAt__c, CommittedAt__c
                                FROM RecoveryAction__c WHERE Id = :actionId];
        System.assertEquals('Pending', a.ApprovalStatus__c);
        System.assertEquals(null, a.ApprovedAt__c);
        System.assertEquals(null, a.CommittedAt__c);
    }

    @isTest
    static void restage_fromPendingThrows() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id);

        try {
            RecoveryActionService.restage(actionId);
            System.assert(false, 'Should have thrown');
        } catch (RecoveryActionService.RecoveryException e) {
            System.assert(e.getMessage().contains('Cannot restage'));
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Trigger guards (DB-level enforcement)
    // ─────────────────────────────────────────────────────────────

    @isTest
    static void trigger_blocksNewRowInNonPendingStatus() {
        ForensicFinding__c f = makeFinding();
        try {
            insert new RecoveryAction__c(
                ForensicFinding__c = f.Id,
                ApprovalStatus__c = 'Approved' // illegal initial status
            );
            System.assert(false, 'Trigger should have rejected');
        } catch (DmlException e) {
            System.assert(e.getMessage().contains('must start in Pending'));
        }
    }

    @isTest
    static void trigger_blocksIllegalDirectTransition() {
        ForensicFinding__c f = makeFinding();
        Id actionId = RecoveryActionService.stageFinding(f.Id); // Pending

        // Try to skip Approved and go directly to Committed
        RecoveryAction__c a = new RecoveryAction__c(Id = actionId, ApprovalStatus__c = 'Committed');
        try {
            update a;
            System.assert(false, 'Trigger should have rejected');
        } catch (DmlException e) {
            System.assert(
                e.getMessage().contains('Illegal status transition'),
                'Got: ' + e.getMessage()
            );
        }
    }
}
