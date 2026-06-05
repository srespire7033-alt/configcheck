/**
 * Class C — Conflicting Automation.
 *
 * Looks for active Price Rules whose Actions target a pricing field
 * (NetPrice / Discount / ListPrice). On a remote scan, queries the
 * target org via OrgQueryService. On a local scan against a host org
 * that doesn't have CPQ installed (Phase 9 — most hosts), the SOQL
 * fails and this tracer returns an empty list silently — Class C
 * only adds value when the org under audit actually has CPQ pricing
 * automation.
 *
 * Caches the rules query at the DetectorContext level (one fetch per
 * scan, reused across every finding) — without this, a 50-finding
 * scan would re-pull 500 rules 50 times.
 *
 * Routes (v1):
 *   - REN-001 / REN-002 / DSC-FOR-001 / DSC-FOR-002 / QL-FOR-002 →
 *       NetPrice/Discount-targeting rules:
 *         1.0 with explicit Renewal condition
 *         0.7 without
 *         0.4 if targeting a related pricing field, not NetPrice
 */
public class ClassCTracer implements IAttributionTracer {

    public String getRootCauseClass() { return 'C'; }

    // Cache key: scanId. Value: parsed pricing rules ready to scan.
    private static Map<Id, List<Map<String, Object>>> RULES_CACHE
        = new Map<Id, List<Map<String, Object>>>();
    private static Set<Id> RULES_CACHE_FAILED = new Set<Id>();

    private static final Set<String> ELIGIBLE_DETECTORS = new Set<String>{
        'REN-001', 'REN-002', 'DSC-FOR-001', 'DSC-FOR-002', 'QL-FOR-002'
    };
    private static final Set<String> PRICING_FIELDS = new Set<String>{
        'SBQQ__NetPrice__c', 'SBQQ__Price__c',
        'SBQQ__Discount__c', 'SBQQ__ListPrice__c'
    };

    public List<AttributionCandidate> trace(
        ForensicFinding__c f,
        Map<String, Object> meta,
        DetectorContext ctx
    ) {
        if (!ELIGIBLE_DETECTORS.contains(f.DetectorId__c)) {
            return new List<AttributionCandidate>();
        }

        List<Map<String, Object>> rules = loadRules(ctx);
        if (rules == null || rules.isEmpty()) return new List<AttributionCandidate>();

        List<AttributionCandidate> out = new List<AttributionCandidate>();
        for (Map<String, Object> rule : rules) {
            List<Map<String, Object>> actions = childRows(rule, 'SBQQ__PriceActions__r');
            List<Map<String, Object>> conditions = childRows(rule, 'SBQQ__PriceConditions__r');

            // Does this rule target a pricing field?
            Map<String, Object> netPriceAction = null;
            Map<String, Object> anyPricingAction = null;
            for (Map<String, Object> a : actions) {
                String tf = String.valueOf(a.get('SBQQ__TargetField__c'));
                if (tf == null) tf = String.valueOf(a.get('SBQQ__FieldName__c'));
                if (tf == null) tf = String.valueOf(a.get('SBQQ__Field__c'));
                if (tf == null || !PRICING_FIELDS.contains(tf)) continue;
                anyPricingAction = a;
                if (tf == 'SBQQ__NetPrice__c') { netPriceAction = a; break; }
            }
            if (anyPricingAction == null) continue;

            Boolean hasRenewalCondition = false;
            for (Map<String, Object> cond : conditions) {
                String field = lower(cond.get('SBQQ__Field__c'));
                String value = lower(cond.get('SBQQ__Value__c'));
                if (field != null && value != null
                    && field.contains('type') && value.contains('renewal')) {
                    hasRenewalCondition = true;
                    break;
                }
            }

            Decimal conf;
            String reason;
            if (netPriceAction != null && hasRenewalCondition) {
                conf = 1.0; reason = 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL';
            } else if (netPriceAction != null) {
                conf = 0.7; reason = 'RULE_OVERRIDES_NETPRICE_BROADLY';
            } else {
                conf = 0.4; reason = 'RULE_OVERRIDES_RELATED_PRICING_FIELD';
            }

            Map<String, Object> primaryAction = netPriceAction != null
                ? netPriceAction : anyPricingAction;

            AttributionCandidate c = new AttributionCandidate();
            c.rootCauseClass = 'C';
            c.rootConfigType = 'SBQQ__PriceRule__c';
            c.rootConfigId   = (String) rule.get('Id');
            c.rootConfigName = (String) rule.get('Name');
            c.reasonCode = reason;
            c.confidence = conf;
            c.evidence.put('evaluation_event', rule.get('SBQQ__EvaluationEvent__c'));
            c.evidence.put('target_field', resolveTargetField(primaryAction));
            c.evidence.put('action_value',
                primaryAction.get('SBQQ__Value__c') != null
                    ? primaryAction.get('SBQQ__Value__c')
                    : primaryAction.get('SBQQ__Formula__c'));
            c.evidence.put('renewal_condition_present', hasRenewalCondition);
            c.evidence.put('affected_record_id', f.PrimaryRecordId__c);
            out.add(c);
        }
        return out;
    }

    /**
     * Pulls + caches active SBQQ__PriceRule__c records with their
     * Actions + Conditions. Returns null if the org doesn't have CPQ
     * (the SOQL will throw on the SBQQ__ object names).
     */
    private List<Map<String, Object>> loadRules(DetectorContext ctx) {
        if (ctx == null || ctx.scanId == null) return null;
        if (RULES_CACHE.containsKey(ctx.scanId)) return RULES_CACHE.get(ctx.scanId);
        if (RULES_CACHE_FAILED.contains(ctx.scanId)) return null;

        try {
            String soql =
                'SELECT Id, Name, SBQQ__Active__c, SBQQ__EvaluationEvent__c, ' +
                '  (SELECT Id, SBQQ__TargetField__c, SBQQ__FieldName__c, ' +
                '          SBQQ__SourceField__c, SBQQ__Value__c, SBQQ__Formula__c ' +
                '   FROM SBQQ__PriceActions__r), ' +
                '  (SELECT Id, SBQQ__Field__c, SBQQ__Operator__c, ' +
                '          SBQQ__Value__c, SBQQ__Object__c ' +
                '   FROM SBQQ__PriceConditions__r) ' +
                'FROM SBQQ__PriceRule__c ' +
                'WHERE SBQQ__Active__c = true ' +
                'LIMIT 500';
            List<Map<String, Object>> rules = OrgQueryService.query(ctx, soql);
            RULES_CACHE.put(ctx.scanId, rules);
            return rules;
        } catch (Exception e) {
            // Host org has no CPQ, or user lacks access — fail silently
            // so the rest of the tracer pipeline keeps working.
            System.debug(LoggingLevel.INFO,
                'ClassCTracer.loadRules skipped: ' + e.getMessage());
            RULES_CACHE_FAILED.add(ctx.scanId);
            return null;
        }
    }

    private List<Map<String, Object>> childRows(Map<String, Object> row, String relName) {
        Object rel = row.get(relName);
        if (rel instanceof Map<String, Object>) {
            Object recs = ((Map<String, Object>) rel).get('records');
            if (recs instanceof List<Object>) return castMapList((List<Object>) recs);
        }
        if (rel instanceof List<Object>) return castMapList((List<Object>) rel);
        return new List<Map<String, Object>>();
    }

    private List<Map<String, Object>> castMapList(List<Object> raw) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object o : raw) {
            if (o instanceof Map<String, Object>) out.add((Map<String, Object>) o);
        }
        return out;
    }

    private String resolveTargetField(Map<String, Object> action) {
        Object v = action.get('SBQQ__TargetField__c');
        if (v == null) v = action.get('SBQQ__FieldName__c');
        if (v == null) v = action.get('SBQQ__Field__c');
        return v == null ? null : String.valueOf(v);
    }

    private String lower(Object o) {
        return o == null ? null : String.valueOf(o).toLowerCase();
    }

    @TestVisible
    static void primeCacheForTest(Id scanId, List<Map<String, Object>> rules) {
        RULES_CACHE.put(scanId, rules);
    }
}
