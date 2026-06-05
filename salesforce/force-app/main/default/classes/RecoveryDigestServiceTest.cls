/**
 * Phase 15b coverage. We avoid asserting on the actual email body
 * — Apex tests can't read sent emails — but we DO exercise the
 * full happy path (compute → email build → sendEmail) under
 * Messaging.reserveSingleEmailCapacity guards.
 */
@IsTest
private class RecoveryDigestServiceTest {

    private static ForensicFinding__c makeFinding() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', ProductType__c = 'CPQ',
            StartedAt__c = System.now()
        );
        insert s;
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = s.Id, DetectorId__c = 'REN-001',
            Severity__c = 'Critical', Title__c = 'test', Status__c = 'Open',
            DetectedAt__c = System.now(), GapUsd__c = 1000,
            RecoverabilityScore__c = 0.8
        );
        insert f;
        return f;
    }

    @IsTest
    static void buildDigest_counts_staged_approved_committed() {
        ForensicFinding__c f = makeFinding();
        Id userId = UserInfo.getUserId();

        Id a1 = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(a1);
        RecoveryActionService.markCommitted(a1);

        Datetime start1 = System.now().addDays(-1);
        Datetime end1 = System.now().addDays(1);

        Test.startTest();
        RecoveryDigestService.DigestRow row =
            RecoveryDigestService.buildDigestForUser(userId, start1, end1);
        Test.stopTest();

        System.assertEquals(userId, row.userId);
        System.assertEquals(1, row.stagedCount);
        System.assertEquals(1, row.approvedCount);
        System.assertEquals(1, row.committedCount);
        System.assertNotEquals(0, row.projectedReclaimUsd);
    }

    @IsTest
    static void buildDigest_outside_window_returns_zero_counts() {
        ForensicFinding__c f = makeFinding();
        RecoveryActionService.stageFinding(f.Id);

        // Window in the future — nothing should count.
        Datetime start1 = System.now().addDays(7);
        Datetime end1 = System.now().addDays(14);
        RecoveryDigestService.DigestRow row =
            RecoveryDigestService.buildDigestForUser(UserInfo.getUserId(), start1, end1);
        System.assertEquals(0, row.stagedCount);
        System.assertEquals(0, row.committedCount);
    }

    @IsTest
    static void sendWeeklyDigest_returns_count_or_zero() {
        // No activity yet — no emails should send.
        Test.startTest();
        Integer sent1 = RecoveryDigestService.sendWeeklyDigest();
        Test.stopTest();
        System.assertEquals(0, sent1, 'No actions → no email');
    }

    @IsTest
    static void sendWeeklyDigest_emails_active_consultants_with_activity() {
        ForensicFinding__c f = makeFinding();
        Id a1 = RecoveryActionService.stageFinding(f.Id);
        RecoveryActionService.approve(a1);
        RecoveryActionService.markCommitted(a1);

        Test.startTest();
        Integer sent1 = RecoveryDigestService.sendWeeklyDigest();
        Test.stopTest();

        // The running user has activity AND is active → one email.
        System.assertEquals(1, sent1, 'Expected one digest email for the running consultant');
    }

    @IsTest
    static void scheduler_executes_without_error() {
        // Wire the scheduler to fire immediately so we hit its code path.
        Test.startTest();
        String cron = '0 0 0 1 1 ? 2050'; // one-shot in the far future
        Id jobId = System.schedule('Test digest', cron, new RecoveryDigestScheduler());
        Test.stopTest();
        System.assertNotEquals(null, jobId);

        // Also call execute() directly to cover the body.
        new RecoveryDigestScheduler().execute(null);
    }
}
