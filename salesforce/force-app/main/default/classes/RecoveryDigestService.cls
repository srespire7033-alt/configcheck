/**
 * Phase 15b — Recovery digest emails.
 *
 * Builds a weekly per-consultant summary of recovery-queue activity
 * over the last 7 days: how many actions they staged, how many they
 * approved, how many they committed, how many regressed under
 * verification, and the rolled-up projected reclaim.
 *
 * Targets recipients = distinct CreatedBy on RecoveryAction__c rows
 * with activity in the window. Consultants who didn't touch the queue
 * this week get nothing — no spam.
 *
 * Public surface:
 *   sendWeeklyDigest()           — production entry point; sends one
 *                                  email per consultant with activity
 *   buildDigestForUser(userId)   — pure compute; returns a DigestRow
 *                                  for the given consultant (used by
 *                                  the scheduler + tests)
 *
 * The Schedulable wrapper RecoveryDigestScheduler fires this weekly.
 */
public with sharing class RecoveryDigestService {

    /** Per-consultant summary shaped for the email template. */
    public class DigestRow {
        public Id userId;
        public String userName;
        public String userEmail;
        public Integer stagedCount = 0;
        public Integer approvedCount = 0;
        public Integer committedCount = 0;
        public Integer verifiedCount = 0;
        public Integer regressedCount = 0;
        public Decimal projectedReclaimUsd = 0;
        public Decimal verifiedReclaimUsd = 0;
        public Datetime windowStart;
        public Datetime windowEnd;
    }

    /**
     * Send digest emails to every consultant who had recovery activity
     * in the last 7 days. Returns the count of emails sent so callers
     * (and the scheduler) can log it.
     */
    public static Integer sendWeeklyDigest() {
        Datetime windowEnd = System.now();
        Datetime windowStart = windowEnd.addDays(-7);

        // Find consultants with activity in the window: anyone who
        // created a RecoveryAction__c OR who updated one (state
        // transitions). Use AggregateResult to keep this single-query.
        Set<Id> userIds = new Set<Id>();
        for (AggregateResult ag : [
            SELECT CreatedById uid
            FROM RecoveryAction__c
            WHERE CreatedDate >= :windowStart
            WITH SECURITY_ENFORCED
            GROUP BY CreatedById
        ]) {
            userIds.add((Id) ag.get('uid'));
        }
        for (AggregateResult ag : [
            SELECT LastModifiedById uid
            FROM RecoveryAction__c
            WHERE LastModifiedDate >= :windowStart
            WITH SECURITY_ENFORCED
            GROUP BY LastModifiedById
        ]) {
            userIds.add((Id) ag.get('uid'));
        }
        if (userIds.isEmpty()) return 0;

        // Pull user records for name + email; skip inactive accounts.
        Map<Id, User> usersById = new Map<Id, User>([
            SELECT Id, Name, Email, IsActive
            FROM User WHERE Id IN :userIds AND IsActive = true
        ]);
        if (usersById.isEmpty()) return 0;

        List<Messaging.SingleEmailMessage> emails = new List<Messaging.SingleEmailMessage>();
        for (Id uid : usersById.keySet()) {
            DigestRow row = buildDigestForUser(uid, windowStart, windowEnd);
            if (row == null || row.stagedCount + row.approvedCount + row.committedCount == 0) {
                continue; // nothing happened this week → no email
            }
            User u = usersById.get(uid);
            row.userName = u.Name;
            row.userEmail = u.Email;
            emails.add(buildEmail(row));
        }
        if (emails.isEmpty()) return 0;
        // sendEmail allOrNothing=false so one bad address doesn't tank
        // the whole batch (consultant left the org, mailbox full, etc).
        Messaging.sendEmail(emails, false);
        return emails.size();
    }

    /**
     * Pure compute — returns a DigestRow for a single consultant
     * across the given window. Surfaces both gross activity counts
     * AND projected $ so the digest carries a leadership-friendly
     * number ("you closed $12,500 of leakage this week").
     */
    @TestVisible
    public static DigestRow buildDigestForUser(Id userId, Datetime windowStart, Datetime windowEnd) {
        DigestRow r = new DigestRow();
        r.userId = userId;
        r.windowStart = windowStart;
        r.windowEnd = windowEnd;

        // Newly staged in window.
        for (AggregateResult ag : [
            SELECT COUNT(Id) cnt, SUM(ProjectedReclaimUsd__c) usd
            FROM RecoveryAction__c
            WHERE CreatedById = :userId AND CreatedDate >= :windowStart
              AND CreatedDate <= :windowEnd
            WITH SECURITY_ENFORCED
        ]) {
            r.stagedCount = (Integer) ag.get('cnt');
            r.projectedReclaimUsd = ag.get('usd') == null ? 0 : (Decimal) ag.get('usd');
        }

        // Approved / committed within window — we approximate via
        // ApprovedAt__c / CommittedAt__c since those are stamped
        // server-side and live on the action itself.
        for (AggregateResult ag : [
            SELECT COUNT(Id) cnt
            FROM RecoveryAction__c
            WHERE LastModifiedById = :userId
              AND ApprovedAt__c >= :windowStart AND ApprovedAt__c <= :windowEnd
            WITH SECURITY_ENFORCED
        ]) {
            r.approvedCount = (Integer) ag.get('cnt');
        }
        for (AggregateResult ag : [
            SELECT COUNT(Id) cnt, SUM(ProjectedReclaimUsd__c) usd
            FROM RecoveryAction__c
            WHERE LastModifiedById = :userId
              AND CommittedAt__c >= :windowStart AND CommittedAt__c <= :windowEnd
            WITH SECURITY_ENFORCED
        ]) {
            r.committedCount = (Integer) ag.get('cnt');
            r.verifiedReclaimUsd = ag.get('usd') == null ? 0 : (Decimal) ag.get('usd');
        }

        // Verified vs regressed (sub-counts of committed actions).
        for (AggregateResult ag : [
            SELECT CommitVerified__c verified, COUNT(Id) cnt
            FROM RecoveryAction__c
            WHERE LastModifiedById = :userId
              AND CommittedAt__c >= :windowStart AND CommittedAt__c <= :windowEnd
            WITH SECURITY_ENFORCED
            GROUP BY CommitVerified__c
        ]) {
            Boolean v = (Boolean) ag.get('verified');
            Integer c = (Integer) ag.get('cnt');
            if (v == true) r.verifiedCount = c;
            else if (v == false) r.regressedCount = c;
        }
        return r;
    }

    /**
     * Build the email body. Plain-text + HTML kept simple so the
     * digest reads cleanly in any mail client. We avoid embedding
     * URLs to specific records since the running schedule context
     * doesn't have access to the org's My Domain.
     */
    @TestVisible
    private static Messaging.SingleEmailMessage buildEmail(DigestRow r) {
        Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
        m.setToAddresses(new List<String>{ r.userEmail });
        m.setSubject(
            'OrgPrism · Your recovery activity this week (' +
            r.committedCount + ' committed, ' +
            money(r.verifiedReclaimUsd) + ' reclaimed)'
        );

        String greeting = 'Hi ' + (r.userName == null ? 'there' : r.userName.substringBefore(' ')) + ',';
        String window1 = formatDate(r.windowStart) + ' → ' + formatDate(r.windowEnd);

        // Plain-text body for mail clients that don't render HTML.
        String text = greeting + '\n\n' +
            'Here is your OrgPrism recovery activity for ' + window1 + ':\n\n' +
            '  • Staged:     ' + r.stagedCount + ' new actions  ('
                + money(r.projectedReclaimUsd) + ' projected reclaim)\n' +
            '  • Approved:   ' + r.approvedCount + '\n' +
            '  • Committed:  ' + r.committedCount + '  (' + money(r.verifiedReclaimUsd) + ' reclaimed)\n' +
            '  • Verified:   ' + r.verifiedCount + '\n' +
            '  • Regressed:  ' + r.regressedCount + (r.regressedCount > 0 ? '  ⚠ needs your attention' : '') + '\n\n' +
            'Open OrgPrism in Salesforce to drill into any of these.\n\n' +
            '— OrgPrism';
        m.setPlainTextBody(text);

        String html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">' +
            '<p>' + greeting + '</p>' +
            '<p>Here is your OrgPrism recovery activity for <strong>' + window1 + '</strong>:</p>' +
            '<table style="border-collapse:collapse;margin:8px 0;">' +
            row1('Staged',    r.stagedCount,    money(r.projectedReclaimUsd) + ' projected') +
            row1('Approved',  r.approvedCount,  '') +
            row1('Committed', r.committedCount, money(r.verifiedReclaimUsd) + ' reclaimed') +
            row1('Verified',  r.verifiedCount,  '') +
            row1('Regressed', r.regressedCount, r.regressedCount > 0 ? '<span style="color:#dc2626;">⚠ needs your attention</span>' : '') +
            '</table>' +
            '<p>Open OrgPrism in Salesforce to drill into any of these.</p>' +
            '<p style="color:#6b7280;font-size:0.85em;">— OrgPrism</p>' +
            '</div>';
        m.setHtmlBody(html);
        m.setSaveAsActivity(false);
        return m;
    }

    private static String row1(String label, Integer count, String extra) {
        return '<tr>' +
            '<td style="padding:4px 16px 4px 0;color:#6b7280;">' + label + '</td>' +
            '<td style="padding:4px 16px 4px 0;font-weight:600;">' + count + '</td>' +
            '<td style="padding:4px 0;color:#6b7280;">' + (extra == null ? '' : extra) + '</td>' +
            '</tr>';
    }

    private static String money(Decimal d) {
        if (d == null || d == 0) return '$0';
        // Reuse the formatting style from FindingRenderer but inline so
        // we don't take a dependency on it.
        Decimal abs1 = d.abs();
        String body = (abs1 == abs1.setScale(0))
            ? formatCommas(abs1.setScale(0))
            : formatCommas(abs1.setScale(2));
        return (d < 0 ? '-$' : '$') + body;
    }

    private static String formatCommas(Decimal d) {
        String raw = d.toPlainString();
        Boolean hasFrac = raw.contains('.');
        String intPart = hasFrac ? raw.substringBefore('.') : raw;
        String fracPart = hasFrac ? raw.substringAfter('.') : '';
        String body = '';
        Integer n = intPart.length();
        for (Integer i = 0; i < n; i++) {
            if (i > 0 && Math.mod(n - i, 3) == 0) body += ',';
            body += intPart.substring(i, i + 1);
        }
        return hasFrac ? body + '.' + fracPart : body;
    }

    private static String formatDate(Datetime d) {
        return d == null ? '' : d.format('MMM d, yyyy');
    }
}

