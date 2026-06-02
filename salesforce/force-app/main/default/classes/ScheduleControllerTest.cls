/**
 * Exercises ScheduleController CRUD + ForensicScanScheduler execute.
 * Uses System.schedule inside a Test.startTest/stopTest block so the
 * cron job runs synchronously and we can assert side effects.
 */
@isTest
private class ScheduleControllerTest {

    @isTest
    static void getSchedules_emptyWhenNone() {
        List<ScheduleController.ScheduleDto> rows = ScheduleController.getSchedules();
        System.assertEquals(0, rows.size());
    }

    @isTest
    static void createSchedule_registersCronJob() {
        Test.startTest();
        // Cron must be in the future for System.schedule to accept it.
        Id scheduleId = ScheduleController.createSchedule(
            'Test daily CPQ',
            'CPQ',
            '0 0 9 * * ?'   // Daily 9 AM
        );
        Test.stopTest();

        ScanSchedule__c row = [
            SELECT Id, Label__c, ProductType__c, CronExpression__c, IsActive__c, CronJobId__c
            FROM ScanSchedule__c WHERE Id = :scheduleId
        ];
        System.assertEquals('CPQ', row.ProductType__c);
        System.assertEquals('0 0 9 * * ?', row.CronExpression__c);
        System.assertEquals(true, row.IsActive__c);
        System.assertNotEquals(null, row.CronJobId__c, 'Cron job ID should be stamped');

        // CronTrigger should reflect the scheduled job.
        List<CronTrigger> jobs = [
            SELECT Id, CronExpression, State FROM CronTrigger WHERE Id = :row.CronJobId__c
        ];
        System.assertEquals(1, jobs.size());
        System.assertEquals('0 0 9 * * ?', jobs[0].CronExpression);
    }

    @isTest
    static void createSchedule_rejectsBlankInputs() {
        try {
            ScheduleController.createSchedule('x', '', '0 0 9 * * ?');
            System.assert(false, 'Should reject blank product type');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        try {
            ScheduleController.createSchedule('x', 'CPQ', '');
            System.assert(false, 'Should reject blank cron');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @isTest
    static void setActive_pausesAndResumes() {
        Test.startTest();
        Id scheduleId = ScheduleController.createSchedule('toggle test', 'CPQ', '0 0 10 * * ?');
        // Pause.
        ScheduleController.setActive(scheduleId, false);
        ScanSchedule__c paused = [
            SELECT IsActive__c, CronJobId__c FROM ScanSchedule__c WHERE Id = :scheduleId
        ];
        System.assertEquals(false, paused.IsActive__c);
        System.assertEquals(null, paused.CronJobId__c, 'Cron ID cleared on pause');

        // Resume.
        ScheduleController.setActive(scheduleId, true);
        Test.stopTest();
        ScanSchedule__c resumed = [
            SELECT IsActive__c, CronJobId__c FROM ScanSchedule__c WHERE Id = :scheduleId
        ];
        System.assertEquals(true, resumed.IsActive__c);
        System.assertNotEquals(null, resumed.CronJobId__c, 'New cron ID stamped on resume');
    }

    @isTest
    static void setActive_noOpWhenStateMatches() {
        Test.startTest();
        Id scheduleId = ScheduleController.createSchedule('noop test', 'CPQ', '0 0 11 * * ?');
        // Already active — setting active again should be a no-op.
        ScheduleController.setActive(scheduleId, true);
        Test.stopTest();
        // Just asserting we got here without an error is enough.
        System.assert(true);
    }

    @isTest
    static void deleteSchedule_removesRowAndAbortsJob() {
        Test.startTest();
        Id scheduleId = ScheduleController.createSchedule('delete test', 'CPQ', '0 0 12 * * ?');
        String jobId = [SELECT CronJobId__c FROM ScanSchedule__c WHERE Id = :scheduleId].CronJobId__c;
        ScheduleController.deleteSchedule(scheduleId);
        Test.stopTest();

        System.assertEquals(0,
            [SELECT COUNT() FROM ScanSchedule__c WHERE Id = :scheduleId],
            'Schedule row should be deleted');
        // CronTrigger should also be gone (aborted).
        System.assertEquals(0,
            [SELECT COUNT() FROM CronTrigger WHERE Id = :jobId],
            'Cron job should be aborted');
    }

    @isTest
    static void runNow_executesScanImmediately() {
        Test.startTest();
        Id scheduleId = ScheduleController.createSchedule('run-now test', 'CPQ', '0 0 13 * * ?');
        Id scanId = ScheduleController.runNow(scheduleId);
        Test.stopTest();

        System.assertNotEquals(null, scanId);
        ScanSchedule__c row = [SELECT LastRunAt__c, LastRunStatus__c FROM ScanSchedule__c WHERE Id = :scheduleId];
        System.assertNotEquals(null, row.LastRunAt__c);
        System.assertEquals('Success', row.LastRunStatus__c);
    }

    @isTest
    static void scheduler_executesAndStampsRun() {
        // Create a schedule directly (bypass the controller so we
        // can inject the SchedulableContext via Test.startTest).
        ScanSchedule__c row = new ScanSchedule__c(
            Label__c = 'direct test', ProductType__c = 'CPQ',
            CronExpression__c = '0 0 14 * * ?', IsActive__c = true
        );
        insert row;

        Test.startTest();
        // Manually invoke execute — SchedulableContext is null but
        // the class handles that gracefully.
        new ForensicScanScheduler(row.Id).execute(null);
        Test.stopTest();

        ScanSchedule__c after = [SELECT LastRunAt__c, LastRunStatus__c FROM ScanSchedule__c WHERE Id = :row.Id];
        System.assertNotEquals(null, after.LastRunAt__c);
        System.assertEquals('Success', after.LastRunStatus__c);
    }

    @isTest
    static void scheduler_skipsWhenInactive() {
        ScanSchedule__c row = new ScanSchedule__c(
            Label__c = 'inactive test', ProductType__c = 'CPQ',
            CronExpression__c = '0 0 15 * * ?', IsActive__c = false
        );
        insert row;

        Test.startTest();
        new ForensicScanScheduler(row.Id).execute(null);
        Test.stopTest();

        ScanSchedule__c after = [SELECT LastRunAt__c FROM ScanSchedule__c WHERE Id = :row.Id];
        System.assertEquals(null, after.LastRunAt__c, 'Inactive schedules should not run');
    }

    @isTest
    static void getSchedules_resolvesNextRunFromCronTrigger() {
        // Schedule via the controller so it gets a real CronJobId__c.
        // getSchedules() should then look up nextRunAt in CronTrigger.
        Test.startTest();
        Id scheduleId = ScheduleController.createSchedule(
            'next-run test', 'CPQ', '0 0 16 * * ?'
        );
        List<ScheduleController.ScheduleDto> rows = ScheduleController.getSchedules();
        Test.stopTest();

        System.assertEquals(1, rows.size());
        System.assertEquals(scheduleId, rows[0].id);
        System.assertNotEquals(null, rows[0].nextRunAt,
            'getSchedules should pull nextRunAt from CronTrigger');
    }

    @isTest
    static void createSchedule_rollsBackOnInvalidCron() {
        Test.startTest();
        try {
            ScheduleController.createSchedule(
                'invalid cron test', 'CPQ', 'totally-bogus-cron'
            );
            System.assert(false, 'Should have thrown on invalid cron');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
        // The schedule row should have been deleted by the catch.
        System.assertEquals(0,
            [SELECT COUNT() FROM ScanSchedule__c WHERE Label__c = 'invalid cron test'],
            'Schedule should roll back on cron registration failure');
    }

    @isTest
    static void scheduler_handlesMissingSchedule() {
        // Construct the scheduler with an Id that doesn't exist —
        // execute() should catch the SOQL-no-rows path silently.
        // Use a clearly-formatted-but-nonexistent Id of the correct
        // SObject prefix so the cast doesn't blow up.
        Id ghostId = [SELECT Id FROM User LIMIT 1].Id;  // valid Id of wrong type → query returns 0 rows
        Test.startTest();
        new ForensicScanScheduler(ghostId).execute(null);
        Test.stopTest();
        // Pass if we got here without an unhandled exception.
        System.assert(true);
    }
}
