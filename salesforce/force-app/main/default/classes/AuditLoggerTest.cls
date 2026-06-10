/**
 * Phase 24z-I — AuditLogger tests.
 *
 * Covers: enqueue + flush, three severity levels, exception overload
 * captures type + stack, null-scan + blank-source drops are silent,
 * logger never throws.
 */
@isTest
private class AuditLoggerTest {

    private static Id makeScan() {
        ForensicScan__c s = new ForensicScan__c(
            Status__c = 'Running', StartedAt__c = System.now()
        );
        insert s;
        return s.Id;
    }

    @isTest
    static void info_warn_error_persistAtFlush() {
        Id scanId = makeScan();
        Test.startTest();
        AuditLogger.info(scanId, AuditLogger.SRC_PROBE, null, 'probe ok');
        AuditLogger.warn(scanId, AuditLogger.SRC_GATING, 'ARM-001', 'gated');
        AuditLogger.error(scanId, AuditLogger.SRC_DETECTOR, 'REN-001', 'boom');
        // Before flush: buffer has 3, no DML yet.
        System.assertEquals(3, AuditLogger.buffer.size(),
            'Three events should be buffered');
        AuditLogger.flush();
        Test.stopTest();

        List<ScanAuditEvent__c> events = [
            SELECT Severity__c, Source__c, DetectorId__c, Message__c
            FROM ScanAuditEvent__c WHERE ForensicScan__c = :scanId
            ORDER BY CreatedDate
        ];
        System.assertEquals(3, events.size());
        System.assertEquals('Info',  events[0].Severity__c);
        System.assertEquals('Warn',  events[1].Severity__c);
        System.assertEquals('Error', events[2].Severity__c);
        System.assertEquals('ARM-001', events[1].DetectorId__c);
        System.assertEquals('probe ok', events[0].Message__c);
    }

    @isTest
    static void error_withException_capturesTypeAndStack() {
        Id scanId = makeScan();
        Exception captured;
        try {
            // Force a real exception so getStackTraceString() returns real frames.
            String[] empty = new String[]{};
            String unreachable = empty[5];
        } catch (Exception e) {
            captured = e;
        }
        Test.startTest();
        AuditLogger.error(scanId, AuditLogger.SRC_DETECTOR, 'TEST-001',
            'forced failure', captured);
        AuditLogger.flush();
        Test.stopTest();

        ScanAuditEvent__c ev = [
            SELECT Message__c, StackTrace__c FROM ScanAuditEvent__c
            WHERE ForensicScan__c = :scanId LIMIT 1
        ];
        System.assert(ev.Message__c.contains('forced failure'),
            'Caller message preserved');
        System.assert(ev.Message__c.contains('ListException')
            || ev.Message__c.contains('List index'),
            'Exception type/message appended: ' + ev.Message__c);
        System.assertNotEquals(null, ev.StackTrace__c,
            'Stack trace should be captured');
    }

    @isTest
    static void flush_isIdempotent() {
        Id scanId = makeScan();
        AuditLogger.info(scanId, AuditLogger.SRC_OTHER, null, 'one');
        Test.startTest();
        AuditLogger.flush();
        AuditLogger.flush(); // second call must be a no-op
        Test.stopTest();
        Integer ct = [SELECT COUNT() FROM ScanAuditEvent__c WHERE ForensicScan__c = :scanId];
        System.assertEquals(1, ct, 'Second flush must not duplicate');
    }

    @isTest
    static void nullScanId_dropsSilently() {
        Test.startTest();
        AuditLogger.info(null, AuditLogger.SRC_PROBE, null, 'orphan');
        AuditLogger.flush();
        Test.stopTest();
        // Nothing inserted, nothing thrown.
        System.assertEquals(0, [SELECT COUNT() FROM ScanAuditEvent__c],
            'null scanId events should be dropped silently');
    }

    @isTest
    static void blankSource_dropsSilently() {
        Id scanId = makeScan();
        Test.startTest();
        AuditLogger.warn(scanId, '', 'X', 'msg');
        AuditLogger.warn(scanId, null, 'X', 'msg');
        AuditLogger.flush();
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM ScanAuditEvent__c WHERE ForensicScan__c = :scanId]);
    }

    @isTest
    static void longMessage_truncates() {
        Id scanId = makeScan();
        String huge = ''.rightPad(50000, 'x'); // > 32k cap
        Test.startTest();
        AuditLogger.warn(scanId, AuditLogger.SRC_OTHER, null, huge);
        AuditLogger.flush();
        Test.stopTest();
        ScanAuditEvent__c ev = [
            SELECT Message__c FROM ScanAuditEvent__c
            WHERE ForensicScan__c = :scanId LIMIT 1
        ];
        System.assert(ev.Message__c.length() <= 32768,
            'Message must be truncated to fit LongText cap');
    }
}
