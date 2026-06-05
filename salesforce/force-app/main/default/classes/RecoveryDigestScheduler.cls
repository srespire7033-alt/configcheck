/**
 * Phase 15b — weekly cron wrapper around RecoveryDigestService.
 *
 * Schedule once via anonymous Apex:
 *   System.schedule('OrgPrism Recovery Digest',
 *     '0 0 9 ? * MON', new RecoveryDigestScheduler());
 *
 * That fires every Monday at 9 AM org time. The digest covers the
 * trailing 7 days, so Monday morning summarises the prior week of
 * recovery activity for each consultant.
 */
public with sharing class RecoveryDigestScheduler implements Schedulable {

    public void execute(SchedulableContext sc) {
        try {
            Integer sent = RecoveryDigestService.sendWeeklyDigest();
            System.debug(LoggingLevel.INFO,
                'RecoveryDigestScheduler: sent ' + sent + ' digest email(s).');
        } catch (Exception e) {
            // Don't let a digest failure abort the cron job — log
            // and move on so next week still fires.
            System.debug(LoggingLevel.ERROR,
                'RecoveryDigestScheduler failed: ' + e.getMessage());
        }
    }
}
