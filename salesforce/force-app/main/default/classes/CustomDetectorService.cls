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
                       IsActive__c, Version__c
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
            // Phase 24f — severity prefers the static catalog value
            // (Vercel-authoritative per Phase 24b). For -FOR- detectors
            // whose severity escalates by gapUsd, the catalog leaves
            // Severity__c null and resolveSeverity wins via the threshold
            // ladder. getSeverity returns the static value when set and
            // the supplied fallback otherwise, so detectors that DO want
            // gap-based escalation can pass null.
            String staticSev = DetectorCatalogController.getSeverity(
                def.DetectorId__c, null);
            r.severity = staticSev != null
                ? staticSev
                : DetectorCatalogController.resolveSeverity(def.DetectorId__c, r.gapUsd);
            r.recoverabilityScore = DetectorCatalogController.getRecoverability(
                def.DetectorId__c, 0.5);

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
}
