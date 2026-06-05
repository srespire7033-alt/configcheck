/**
 * Phase 16b — Remediation Recipe Service.
 *
 * Renders a polished, finding-specific remediation recipe by:
 *   1. Looking up RemediationRecipe__mdt by DetectorId__c
 *   2. Interpolating {placeholder} tokens against:
 *        - ForensicFinding__c fields (Title__c, PrimaryRecordId__c, GapUsd__c, Severity__c)
 *        - parsed Metadata__c JSON (detector-emitted keys like quoteName, lineIds, etc.)
 *
 * Output is a multi-line string with structure:
 *
 *   <Title>
 *
 *   Effort: <EstimatedEffort>   Skill: <Skill>
 *
 *   Steps:
 *   1. ...
 *   2. ...
 *
 * Wired into ForensicScanService.toFindingRecord() so each finding
 * carries its rendered recipe at insert time. Detector-specific
 * metadata determines exactly what the placeholders resolve to.
 *
 * Token format: {name} — case-sensitive, alphanumeric + underscore.
 * Unknown tokens render as the literal placeholder (e.g. "{quoteName}")
 * rather than erroring, so a recipe written against a richer metadata
 * shape than the detector currently emits degrades gracefully.
 */
public with sharing class RemediationRecipeService {

    /**
     * In-memory cache of recipes by DetectorId. Loaded lazily on first
     * render() call; stays valid for the rest of the transaction.
     * Custom Metadata Types are immutable mid-transaction so this is
     * always safe.
     */
    private static Map<String, RemediationRecipe__mdt> recipeCache;

    /**
     * Render the recipe for a finding. Returns null when no recipe is
     * defined for the detector (caller should leave the field blank).
     */
    public static String render(ForensicFinding__c f) {
        if (f == null || String.isBlank(f.DetectorId__c)) return null;
        RemediationRecipe__mdt recipe = getRecipe(f.DetectorId__c);
        if (recipe == null) return null;

        Map<String, String> tokens = buildTokenMap(f);
        return assemble(recipe, tokens);
    }

    /**
     * AuraEnabled entry point for LWCs that want to re-render on the
     * fly (e.g. an admin tweaked the recipe and the consultant wants
     * to see the updated version without re-running the scan).
     */
    @AuraEnabled(cacheable=true)
    public static String renderForFinding(Id findingId) {
        if (findingId == null) return null;
        List<ForensicFinding__c> rows = [
            SELECT Id, DetectorId__c, Title__c, PrimaryRecordId__c,
                   PrimaryRecordType__c, GapUsd__c, Severity__c, Metadata__c
            FROM ForensicFinding__c
            WHERE Id = :findingId
            WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) return null;
        return render(rows[0]);
    }

    // ── internals ────────────────────────────────────────────────────

    @TestVisible
    private static RemediationRecipe__mdt getRecipe(String detectorId) {
        if (recipeCache == null) {
            recipeCache = new Map<String, RemediationRecipe__mdt>();
            for (RemediationRecipe__mdt m : [
                SELECT DeveloperName, DetectorId__c, Title__c, Steps__c,
                       EstimatedEffort__c, Skill__c, Version__c
                FROM RemediationRecipe__mdt
            ]) {
                if (String.isNotBlank(m.DetectorId__c)) {
                    recipeCache.put(m.DetectorId__c, m);
                }
            }
        }
        return recipeCache.get(detectorId);
    }

    /**
     * Build the placeholder → value map from finding fields + parsed
     * metadata JSON. Metadata keys override field-level tokens, so
     * detector-emitted values are authoritative when both exist.
     */
    @TestVisible
    private static Map<String, String> buildTokenMap(ForensicFinding__c f) {
        Map<String, String> tokens = new Map<String, String>();
        // Field-level tokens
        tokens.put('detectorId', f.DetectorId__c);
        tokens.put('title', nz(f.Title__c));
        tokens.put('severity', nz(f.Severity__c));
        tokens.put('gapUsd', money(f.GapUsd__c));
        tokens.put('primaryRecordId', nz(f.PrimaryRecordId__c));
        tokens.put('primaryRecordType', nz(f.PrimaryRecordType__c));

        // Metadata JSON tokens (detector-emitted keys)
        if (String.isNotBlank(f.Metadata__c)) {
            try {
                Object parsed = JSON.deserializeUntyped(f.Metadata__c);
                if (parsed instanceof Map<String, Object>) {
                    for (String k : ((Map<String, Object>) parsed).keySet()) {
                        Object v = ((Map<String, Object>) parsed).get(k);
                        tokens.put(k, valueToString(v));
                    }
                }
            } catch (Exception e) {
                // Bad JSON — leave metadata tokens unset; render() will
                // degrade gracefully via the leave-unknown-tokens policy.
            }
        }
        return tokens;
    }

    @TestVisible
    private static String assemble(RemediationRecipe__mdt recipe, Map<String, String> tokens) {
        String title = interpolate(nz(recipe.Title__c), tokens);
        String steps = interpolate(nz(recipe.Steps__c), tokens);
        String effort = nz(recipe.EstimatedEffort__c);
        String skill = nz(recipe.Skill__c);

        // Multi-line output. Effort + skill omitted when empty.
        String out = title;
        if (!String.isBlank(effort) || !String.isBlank(skill)) {
            out += '\n\n';
            if (!String.isBlank(effort)) out += 'Effort: ' + effort;
            if (!String.isBlank(effort) && !String.isBlank(skill)) out += '   ';
            if (!String.isBlank(skill)) out += 'Skill: ' + skill;
        }
        if (!String.isBlank(steps)) {
            out += '\n\nSteps:\n' + steps;
        }
        return out;
    }

    /**
     * Replace every {token} in the source string with its value from
     * the map. Plain literal replacement — no regex. Each token in
     * the map is replaced wherever {key} appears.
     *
     * Unknown tokens are left literal (consultants see the placeholder),
     * signalling "this recipe expected a key the detector didn't emit."
     * That's safer than erroring or showing "null".
     */
    @TestVisible
    private static String interpolate(String template1, Map<String, String> tokens) {
        if (String.isBlank(template1)) return '';
        String out = template1;
        for (String key : tokens.keySet()) {
            String val = tokens.get(key);
            if (String.isBlank(val)) continue; // leave {key} literal so unknown reads better
            out = out.replace('{' + key + '}', val);
        }
        return out;
    }

    private static String nz(String s) { return s == null ? '' : s; }

    private static String money(Decimal d) {
        if (d == null || d == 0) return '$0';
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

    private static String valueToString(Object v) {
        if (v == null) return '';
        if (v instanceof String) return (String) v;
        if (v instanceof List<Object>) {
            // Render a list of ids/names as a comma-joined string.
            List<String> parts = new List<String>();
            for (Object o : (List<Object>) v) parts.add(valueToString(o));
            return String.join(parts, ', ');
        }
        if (v instanceof Decimal || v instanceof Double || v instanceof Integer || v instanceof Long) {
            return String.valueOf(v);
        }
        if (v instanceof Boolean) return ((Boolean) v) ? 'true' : 'false';
        return String.valueOf(v);
    }
}
