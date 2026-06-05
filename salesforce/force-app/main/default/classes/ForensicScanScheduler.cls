/**
 * Schedulable wrapper for ForensicScanService. Each ScanSchedule__c
 * row registers an instance of this class with System.schedule()
 * using its CronExpression__c. The scheduler reads the schedule
 * record's product type at execution time, then delegates to
 * ForensicScanService.startScan.
 *
 * The constructor takes the ScanSchedule__c Id so the same Apex
 * class can power many schedules — each registered job knows which
 * schedule row to look up on fire.
 */
public with sharing class ForensicScanScheduler implements Schedulable {

    private Id scheduleId;

    public ForensicScanScheduler(Id scheduleId) {
        this.scheduleId = scheduleId;
    }

    public void execute(SchedulableContext sc) {
        ScanSchedule__c schedule;
        try {
            schedule = [
                SELECT Id, ProductType__c, IsActive__c
                FROM ScanSchedule__c WHERE Id = :scheduleId WITH SECURITY_ENFORCED LIMIT 1
            ];
        } catch (Exception e) {
            // Schedule was deleted but the cron job survived — abort
            // ourselves so the org doesn't keep firing into a void.
            if (sc != null && sc.getTriggerId() != null) {
                try { System.abortJob(sc.getTriggerId()); } catch (Exception ignored) {}
            }
            return;
        }

        if (schedule == null || schedule.IsActive__c == false) {
            // Paused or inactive — skip the run silently. The
            // toggle path in ScheduleController.setActive() also
            // explicitly aborts the cron job, but this guard
            // protects against race conditions.
            return;
        }

        String runStatus = 'Success';
        try {
            ForensicScanService.startScan(schedule.ProductType__c);
        } catch (Exception e) {
            runStatus = 'Failed';
            System.debug(LoggingLevel.ERROR,
                'Scheduled scan failed for ' + scheduleId + ': ' + e.getMessage());
        }
        // Stamp the run timestamps so the UI shows "Last ran 5 min ago".
        try {
            schedule.LastRunAt__c = System.now();
            schedule.LastRunStatus__c = runStatus;
            update schedule;
        } catch (Exception ignored) {
            // Best-effort — if the stamp fails it's not catastrophic.
        }
    }
}
