/**
 * Phase 19b — Tier 2 self-service detectors.
 *
 * Iterates active CustomDetector__mdt records, executes each one's
 * SOQL via OrgQueryService (so it runs against the LOCAL host org
 * OR a remote target org via Named Credential, same as the coded
 * detectors), turns each returned row into a DetectorResult by
 * interpolating the title/description templates against the row's
 * column values, and returns the merged List for ForensicScanService
 * to persist as findings.
 *
 * Net effect: a customer admin writes one SOQL query in Setup → they
 * get a working detector. No Apex required.
 *
 * Safety:
 *   - Admin-written SOQL is trusted (Setup access required to create
 *     a CustomDetector__mdt record). We don't try to sanitize it.
 *   - A single bad detector (invalid SOQL, missing column, etc.)
 *     never tanks the whole scan — caught + logged + scan continues.
 *   - AppliesTo / IsActive honored before any query executes.
 *   - Each detector runs in its own try/catch.
 */
public with sharing class CustomDetectorService {

    /**
     * Run all active custom detectors for this scan's product type
     * and return the merged DetectorResult list. Caller (ForensicScanService)
     * is responsible for converting them to ForensicFinding__c rows.
     */
    public static List<DetectorResult> runAll(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        if (ctx == null) return results;

        List<CustomDetector__mdt> defs;
        try {
            defs = [
                SELECT DeveloperName, DetectorId__c, Label__c, Category__c, AppliesTo__c,
                       SoqlQuery__c, TitleTemplate__c, DescriptionTemplate__c,
                       PrimaryRecordIdField__c, PrimaryRecordType__c,
                       EntitledUsdField__c, RealizedUsdField__c,
                       IsActive__c, Version__c,
                       Severity__c, RecoverabilityScore__c, Effort__c,
                       CriticalThresholdUsd__c, WarningThresholdUsd__c
                FROM CustomDetector__mdt
                WHERE IsActive__c = true
            ];
        } catch (Exception e) {
            // Object hasn't been deployed yet — return empty, scan continues.
            System.debug(LoggingLevel.INFO,
                'CustomDetector__mdt unavailable: ' + e.getMessage());
            return results;
        }

        for (CustomDetector__mdt def : defs) {
            if (!matchesProductType(def, ctx.productType)) continue;
            if (String.isBlank(def.SoqlQuery__c)) continue;
            try {
                List<DetectorResult> rs = runOne(def, ctx);
                results.addAll(rs);
            } catch (Exception e) {
                // Bad SOQL, missing column, FLS rejection — log + continue.
                System.debug(LoggingLevel.WARN,
                    'CustomDetector ' + def.DetectorId__c +
                    ' failed: ' + e.getMessage());
            }
        }
        return results;
    }

    @TestVisible
    private static List<DetectorResult> runOne(CustomDetector__mdt def, DetectorContext ctx) {
        List<DetectorResult> out = new List<DetectorResult>();
        List<Map<String, Object>> rows;
        try {
            rows = OrgQueryService.query(ctx, def.SoqlQuery__c);
        } catch (Exception e) {
            throw new CustomDetectorException(
                'SOQL execution failed: ' + e.getMessage());
        }
        if (rows == null) return out;

        String pkField = String.isBlank(def.PrimaryRecordIdField__c)
            ? 'Id' : def.PrimaryRecordIdField__c;

        for (Map<String, Object> row : rows) {
            DetectorResult r = new DetectorResult();
            r.detectorId = def.DetectorId__c;
            r.title = interpolate(def.TitleTemplate__c, row);
            r.description = interpolate(def.DescriptionTemplate__c, row);
            r.entitledUsd = toDecimal(row.get(def.EntitledUsdField__c));
            r.realizedUsd = toDecimal(row.get(def.RealizedUsdField__c));
            if (r.realizedUsd == null) r.realizedUsd = 0;
            r.computeGap();
            // Phase 24j — severity/recoverability/thresholds now live
            // directly on CustomDetector__mdt so admins manage the
            // editable detector from a single screen (the matching
            // Detector__mdt twin is no longer consulted for these
            // fields). Behavior matches the Phase 24f resolver:
            //   if Severity__c is set, use it as the static label;
            //   otherwise apply the per-row threshold ladder using
            //   CriticalThresholdUsd__c / WarningThresholdUsd__c, with
            //   the same defaults the catalog used (10000 / 1000).
            if (String.isNotBlank(def.Severity__c)) {
                r.severity = def.Severity__c;
            } else {
                Decimal crit = def.CriticalThresholdUsd__c != null ? def.CriticalThresholdUsd__c : 10000;
                Decimal warn = def.WarningThresholdUsd__c != null ? def.WarningThresholdUsd__c : 1000;
                Decimal gap = r.gapUsd != null ? r.gapUsd : 0;
                r.severity = (gap > crit) ? 'Critical' : (gap > warn ? 'Warning' : 'Info');
            }
            r.recoverabilityScore = def.RecoverabilityScore__c != null
                ? def.RecoverabilityScore__c : 0.5;

            // Primary record handoff for attribution + recovery queue.
            Object pkValue = row.get(pkField);
            if (pkValue != null) {
                r.primaryRecord = new SourceRecord(
                    def.PrimaryRecordType__c,
                    String.valueOf(pkValue),
                    safeString(row.get('Name'))
                );
            }
            // Stash the raw row in metadata so attribution + remediation
            // recipes can interpolate against the same column names.
            for (String k : row.keySet()) {
                r.metadata.put(k, row.get(k));
            }
            out.add(r);
        }
        return out;
    }

    /**
     * Honor the AppliesTo__c filter — semicolon-separated list of
     * product types. Blank = applies to all.
     */
    @TestVisible
    private static Boolean matchesProductType(CustomDetector__mdt def, String productType) {
        if (String.isBlank(productType)) return true;
        if (String.isBlank(def.AppliesTo__c)) return true;
        for (String pt : def.AppliesTo__c.split(';')) {
            if (pt.trim() == productType) return true;
        }
        return false;
    }

    /**
     * Replace every {ColumnName} token in the template with the row's
     * value. Unknown tokens are left literal — admin gets a visible
     * clue that they referenced a column the SOQL didn't return.
     */
    @TestVisible
    private static String interpolate(String template1, Map<String, Object> row) {
        if (String.isBlank(template1)) return '';
        String out = template1;
        for (String key : row.keySet()) {
            String val = formatValue(row.get(key));
            if (String.isBlank(val)) continue;
            out = out.replace('{' + key + '}', val);
        }
        return out;
    }

    @TestVisible
    private static String formatValue(Object v) {
        if (v == null) return '';
        if (v instanceof String) return (String) v;
        if (v instanceof Decimal) return ((Decimal) v).toPlainString();
        if (v instanceof Double)  return String.valueOf((Double) v);
        if (v instanceof Integer) return String.valueOf((Integer) v);
        if (v instanceof Long)    return String.valueOf((Long) v);
        if (v instanceof Boolean) return ((Boolean) v) ? 'true' : 'false';
        if (v instanceof Date)    return String.valueOf((Date) v);
        if (v instanceof Datetime) return String.valueOf((Datetime) v);
        return String.valueOf(v);
    }

    @TestVisible
    private static Decimal toDecimal(Object v) {
        if (v == null) return null;
        if (v instanceof Decimal) return (Decimal) v;
        if (v instanceof Integer) return ((Integer) v) + 0.0;
        if (v instanceof Long)    return ((Long) v) + 0.0;
        if (v instanceof Double)  return Decimal.valueOf((Double) v);
        if (v instanceof String) {
            try { return Decimal.valueOf((String) v); } catch (Exception e) { return null; }
        }
        return null;
    }

    private static String safeString(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    public class CustomDetectorException extends Exception {}

    // ─── Phase 24s — Test query from the admin UI ──────────────────
    //
    // Admin pastes SOQL into the tester, picks a target org, sees how
    // many rows the query returns and a preview of the first 5. Same
    // OrgQueryService path the real scan uses, so what tests passes is
    // what runs.

    public class TestQueryResult {
        @AuraEnabled public Integer rowCount;
        @AuraEnabled public List<String> columns;
        @AuraEnabled public List<Map<String, Object>> sample;
        @AuraEnabled public String error;
    }

    /**
     * Run a candidate SOQL string against a connected org (or the host
     * org if connectedOrgId is null) and return the row count + first 5
     * rows. Read-only — refuses anything that smells like DML.
     */
    @AuraEnabled
    public static TestQueryResult testQuery(String soql, String productType, Id connectedOrgId) {
        TestQueryResult out = new TestQueryResult();
        out.rowCount = 0;
        out.columns = new List<String>();
        out.sample = new List<Map<String, Object>>();
        if (String.isBlank(soql)) {
            out.error = 'Enter a SOQL query first.';
            return out;
        }
        // Strip leading/trailing whitespace and validate read-only.
        String q = soql.trim();
        String upper = q.toUpperCase();
        // Multi-statement and DML keywords blocked. Database.query() can
        // already only execute SELECT, but the explicit guard gives a
        // friendlier error and satisfies AppExchange security review.
        if (q.contains(';')) {
            out.error = 'Multi-statement queries are not allowed.';
            return out;
        }
        for (String banned : new List<String>{
            'INSERT ', 'UPDATE ', 'DELETE ', 'UPSERT ', 'MERGE ',
            'INSERT(', 'UPDATE(', 'DELETE(', 'UPSERT(', 'MERGE('
        }) {
            if (upper.contains(banned)) {
                out.error = 'DML statements are not allowed in detector SOQL.';
                return out;
            }
        }
        if (!upper.startsWith('SELECT ')) {
            out.error = 'Query must start with SELECT.';
            return out;
        }

        // Resolve Named Credential for remote orgs the same way a scan does.
        String nc = null;
        if (connectedOrgId != null) {
            List<ConnectedOrg__c> co = [
                SELECT NamedCredentialName__c FROM ConnectedOrg__c
                WHERE Id = :connectedOrgId LIMIT 1
            ];
            if (!co.isEmpty()) nc = co[0].NamedCredentialName__c;
        }
        DetectorContext ctx = new DetectorContext(
            null,
            UserInfo.getDefaultCurrency(),
            String.isBlank(productType) ? 'CPQ' : productType,
            connectedOrgId,
            nc
        );
        List<Map<String, Object>> rows;
        try {
            rows = OrgQueryService.query(ctx, q);
        } catch (Exception e) {
            out.error = e.getMessage();
            return out;
        }
        if (rows == null) rows = new List<Map<String, Object>>();
        out.rowCount = rows.size();
        if (!rows.isEmpty()) {
            // Columns from the first row's key order — best we can do
            // without parsing the SOQL SELECT clause.
            out.columns.addAll(rows[0].keySet());
            Integer cap = Math.min(5, rows.size());
            for (Integer i = 0; i < cap; i++) out.sample.add(rows[i]);
        }
        return out;
    }
}
