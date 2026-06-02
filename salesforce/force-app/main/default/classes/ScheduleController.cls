/**
 * LWC-facing CRUD for ScanSchedule__c. Each create/delete/toggle
 * synchronously registers or aborts the corresponding cron job via
 * System.schedule / System.abortJob, keeping the org's scheduled-job
 * registry and the ScanSchedule__c table in lockstep.
 *
 * Salesforce constraints to remember:
 *   - Min frequency is hourly (cron seconds/minutes can't be < hour)
 *   - 100 active scheduled jobs per org max
 *   - System.schedule throws if a job with the same name already
 *     exists — we use the schedule Id in the name to keep them unique
 */
public with sharing class ScheduleController {

    public class ScheduleDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;            // auto-number SS-0001
        @AuraEnabled public String label;
        @AuraEnabled public String productType;
        @AuraEnabled public String cronExpression;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Datetime lastRunAt;
        @AuraEnabled public String lastRunStatus;
        @AuraEnabled public String cronJobId;
        @AuraEnabled public Datetime nextRunAt;     // from CronTrigger
    }

    @AuraEnabled(cacheable=true)
    public static List<ScheduleDto> getSchedules() {
        List<ScheduleDto> out = new List<ScheduleDto>();
        List<ScanSchedule__c> rows = [
            SELECT Id, Name, Label__c, ProductType__c, CronExpression__c,
                   IsActive__c, LastRunAt__c, LastRunStatus__c, CronJobId__c
            FROM ScanSchedule__c
            ORDER BY CreatedDate DESC
            LIMIT 100
        ];
        if (rows.isEmpty()) return out;

        Set<String> jobIds = new Set<String>();
        for (ScanSchedule__c r : rows) {
            if (String.isNotBlank(r.CronJobId__c)) jobIds.add(r.CronJobId__c);
        }
        Map<Id, Datetime> nextFireById = new Map<Id, Datetime>();
        if (!jobIds.isEmpty()) {
            for (CronTrigger t : [
                SELECT Id, NextFireTime FROM CronTrigger WHERE Id IN :jobIds
            ]) {
                nextFireById.put(t.Id, t.NextFireTime);
            }
        }

        for (ScanSchedule__c r : rows) {
            ScheduleDto d = new ScheduleDto();
            d.id = r.Id;
            d.name = r.Name;
            d.label = r.Label__c;
            d.productType = r.ProductType__c;
            d.cronExpression = r.CronExpression__c;
            d.isActive = r.IsActive__c;
            d.lastRunAt = r.LastRunAt__c;
            d.lastRunStatus = r.LastRunStatus__c;
            d.cronJobId = r.CronJobId__c;
            if (String.isNotBlank(r.CronJobId__c) && nextFireById.containsKey(r.CronJobId__c)) {
                d.nextRunAt = nextFireById.get(r.CronJobId__c);
            }
            out.add(d);
        }
        return out;
    }

    /**
     * Create a new schedule + register its cron job in one transaction.
     * Returns the new schedule Id so the LWC can refresh.
     */
    @AuraEnabled
    public static Id createSchedule(String label, String productType, String cronExpression) {
        if (String.isBlank(productType)) {
            throw new AuraHandledException('Product type is required');
        }
        if (String.isBlank(cronExpression)) {
            throw new AuraHandledException('Cron expression is required');
        }
        ScanSchedule__c row = new ScanSchedule__c(
            Label__c = String.isBlank(label) ? productType + ' scan' : label,
            ProductType__c = productType,
            CronExpression__c = cronExpression,
            IsActive__c = true
        );
        insert row;

        // Register with the scheduler. The name uses the schedule Id
        // to guarantee uniqueness in the org's job registry.
        String jobName = 'OrgPrism Scan ' + row.Id;
        try {
            String jobId = System.schedule(
                jobName, cronExpression, new ForensicScanScheduler(row.Id)
            );
            row.CronJobId__c = jobId;
            update row;
        } catch (Exception e) {
            // Rollback the schedule row if the cron registration fails.
            delete row;
            throw new AuraHandledException(
                'Failed to schedule scan: ' + e.getMessage()
            );
        }
        return row.Id;
    }

    /**
     * Toggle active state. When deactivating, abort the cron job.
     * When reactivating, re-register it.
     */
    @AuraEnabled
    public static void setActive(Id scheduleId, Boolean active) {
        ScanSchedule__c row = [
            SELECT Id, Label__c, ProductType__c, CronExpression__c,
                   IsActive__c, CronJobId__c
            FROM ScanSchedule__c WHERE Id = :scheduleId LIMIT 1
        ];
        if (active == row.IsActive__c) return; // no-op

        if (active) {
            // Re-register.
            String jobName = 'OrgPrism Scan ' + row.Id;
            String jobId = System.schedule(
                jobName, row.CronExpression__c, new ForensicScanScheduler(row.Id)
            );
            row.CronJobId__c = jobId;
            row.IsActive__c = true;
        } else {
            // Abort the existing cron job. Best-effort; if it's
            // already gone (e.g. someone aborted from Setup) we
            // still mark the row inactive.
            if (String.isNotBlank(row.CronJobId__c)) {
                try { System.abortJob(row.CronJobId__c); } catch (Exception ignored) {}
            }
            row.CronJobId__c = null;
            row.IsActive__c = false;
        }
        update row;
    }

    /**
     * Delete a schedule + unregister its cron job.
     */
    @AuraEnabled
    public static void deleteSchedule(Id scheduleId) {
        ScanSchedule__c row = [
            SELECT Id, CronJobId__c FROM ScanSchedule__c WHERE Id = :scheduleId LIMIT 1
        ];
        if (String.isNotBlank(row.CronJobId__c)) {
            try { System.abortJob(row.CronJobId__c); } catch (Exception ignored) {}
        }
        delete row;
    }

    /**
     * Trigger an immediate one-off run of the schedule's product type.
     * Doesn't touch the cron job — just fires a scan now.
     */
    @AuraEnabled
    public static Id runNow(Id scheduleId) {
        ScanSchedule__c row = [
            SELECT Id, ProductType__c FROM ScanSchedule__c WHERE Id = :scheduleId LIMIT 1
        ];
        Id scanId = ForensicScanService.startScan(row.ProductType__c);
        row.LastRunAt__c = System.now();
        row.LastRunStatus__c = 'Success';
        update row;
        return scanId;
    }
}
