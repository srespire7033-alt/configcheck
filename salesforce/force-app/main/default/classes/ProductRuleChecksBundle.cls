/**
 * Phase 22a-2 â€” Bundle of 3 checks on SBQQ__ProductRule__c.
 *
 *   LQ-003 â€” Selection rule action missing target product (no LookupObject)
 *   LQ-004 â€” Selection rule action targets inactive product (one finding per action)
 *   LQ-005 â€” Selection rule with null EvaluationOrder (only when â‰¥2 selection rules)
 *
 * UA-003 (rule-cleanliness) is owned by PriceRuleChecksBundle which
 * fetches the product-rule inactive count via OrgQueryService â€” keeping
 * UA-003 in one place avoids double-firing.
 */
public with sharing class ProductRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;

    public String getDetectorId() { return 'PRD-BUNDLE'; }
    public String getLabel() { return 'Product Rule health checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        if (testStubRows != null) {
            rows = testStubRows;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ProductRule__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] PRD-BUNDLE: SBQQ__ProductRule__c not present.');
                return results;
            }
            // Phase 22a-3 — widened SELECT for PRD-001..PRD-004:
            // adds SBQQ__ConditionsMet__c (PRD-004) and the
            // SBQQ__ErrorConditions__r subquery (PRD-003).
            //
            // Phase 22n — on REMOTE scans the host org's schema (where
            // SchemaUtil.hasField/hasObject probe) does NOT reflect the
            // target. Stripping the field locally would cause every
            // returned row to be missing it, breaking predicates that
            // depend on its value (false-fired PRD-004 against the cpq
            // target when techtorch host lacked SBQQ__ProductRule__c).
            // On remote, always request optional fields and use
            // queryWithFallback to drop them server-side via INVALID_FIELD
            // if the target genuinely lacks them.
            Boolean isRemote = ctx.isRemote();
            Boolean hasCondMet = isRemote
                || SchemaUtil.hasField('SBQQ__ProductRule__c', 'SBQQ__ConditionsMet__c');
            Boolean hasErrCond = isRemote
                || SchemaUtil.hasObject('SBQQ__ErrorCondition__c');
            String conditionsMetField = hasCondMet ? ', SBQQ__ConditionsMet__c' : '';
            String errorCondSubquery  = hasErrCond
                ? ', (SELECT Id FROM SBQQ__ErrorConditions__r LIMIT 1) ' : ' ';
            String soqlStrict =
                'SELECT Id, Name, SBQQ__Active__c, SBQQ__Type__c, ' +
                '  SBQQ__EvaluationOrder__c, SBQQ__LookupObject__c' + conditionsMetField + ', ' +
                '  (SELECT Id, SBQQ__Type__c, SBQQ__Product__c, ' +
                '          SBQQ__Product__r.Name, SBQQ__Product__r.IsActive ' +
                '   FROM SBQQ__Actions__r)' + errorCondSubquery +
                'FROM SBQQ__ProductRule__c LIMIT 5000';
            // Loose fallback drops both optional bits; evaluatePRD003 /
            // evaluatePRD004 then skip rows where the field/subquery is
            // genuinely absent instead of treating null as "blank".
            String soqlLoose =
                'SELECT Id, Name, SBQQ__Active__c, SBQQ__Type__c, ' +
                '  SBQQ__EvaluationOrder__c, SBQQ__LookupObject__c, ' +
                '  (SELECT Id, SBQQ__Type__c, SBQQ__Product__c, ' +
                '          SBQQ__Product__r.Name, SBQQ__Product__r.IsActive ' +
                '   FROM SBQQ__Actions__r) ' +
                'FROM SBQQ__ProductRule__c LIMIT 5000';
            try {
                rows = OrgQueryService.queryWithFallback(ctx, soqlStrict, soqlLoose);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] PRD-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        Boolean runLQ003 = DetectorCatalogController.isActive('LQ-003');
        Boolean runLQ004 = DetectorCatalogController.isActive('LQ-004');
        Boolean runLQ005 = DetectorCatalogController.isActive('LQ-005');
        // Phase 22a-3
        Boolean runPRD001 = DetectorCatalogController.isActive('PRD-001');
        Boolean runPRD002 = DetectorCatalogController.isActive('PRD-002');
        Boolean runPRD003 = DetectorCatalogController.isActive('PRD-003');
        Boolean runPRD004 = DetectorCatalogController.isActive('PRD-004');
        // PRD-005 deferred — UA-003 (PriceRuleChecksBundle) already
        // counts inactive product rules into one aggregated finding.
        // Re-firing here would double-count the same data.

        if (runLQ003) results.addAll(evaluateLQ003(rows));
        if (runLQ004) results.addAll(evaluateLQ004(rows));
        if (runLQ005) results.addAll(evaluateLQ005(rows));
        if (runPRD001) results.addAll(evaluatePRD001(rows));
        if (runPRD002) results.addAll(evaluatePRD002(rows));
        if (runPRD003) results.addAll(evaluatePRD003(rows));
        if (runPRD004) results.addAll(evaluatePRD004(rows));
        return results;
    }

    // ── PRD-001: same product Added AND Removed/Hidden by different rules ─

    @TestVisible
    static List<DetectorResult> evaluatePRD001(List<Map<String, Object>> rules) {
        // For Selection rules only. Build addByProduct + removeByProduct
        // (Map<Id productId, List<rule>>). Flag products appearing in both.
        Map<Id, List<Map<String, Object>>> addByProduct = new Map<Id, List<Map<String, Object>>>();
        Map<Id, List<Map<String, Object>>> removeByProduct = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            if (typeOf(rule) != 'Selection') continue;
            for (Map<String, Object> act : actionsOf(rule)) {
                Object prodObj = act.get('SBQQ__Product__c');
                if (prodObj == null) continue;
                Id pid = (Id) prodObj;
                String at = (String) act.get('SBQQ__Type__c');
                if (at == 'Add' || at == 'Enable & Add') {
                    if (!addByProduct.containsKey(pid)) addByProduct.put(pid, new List<Map<String, Object>>());
                    addByProduct.get(pid).add(rule);
                } else if (at == 'Remove' || at == 'Hide' || at == 'Disable & Remove') {
                    if (!removeByProduct.containsKey(pid)) removeByProduct.put(pid, new List<Map<String, Object>>());
                    removeByProduct.get(pid).add(rule);
                }
            }
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id pid : addByProduct.keySet()) {
            if (!removeByProduct.containsKey(pid)) continue;
            List<Map<String, Object>> adds = addByProduct.get(pid);
            List<Map<String, Object>> removes = removeByProduct.get(pid);
            List<String> addNames = new List<String>();
            for (Map<String, Object> r : adds) addNames.add('"' + (String) r.get('Name') + '"');
            List<String> remNames = new List<String>();
            for (Map<String, Object> r : removes) remNames.add('"' + (String) r.get('Name') + '"');

            DetectorResult r = new DetectorResult();
            r.detectorId = 'PRD-001';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = 'Conflicting selection rules detected';
            r.description = 'Product (' + String.valueOf(pid) + ') is added by rule(s) ' +
                String.join(addNames, ', ') + ' but removed/hidden by ' +
                String.join(remNames, ', ') +
                '. The product may appear and disappear unpredictably.';
            // Fix from spec: primary is the first conflicting RULE, not the productId.
            r.primaryRecord = asRef(adds[0]);
            for (Integer i = 1; i < adds.size(); i++) r.supportingRecords.add(asRef(adds[i]));
            for (Map<String, Object> rm : removes) r.supportingRecords.add(asRef(rm));
            out.add(r);
        }
        return out;
    }

    // ── PRD-002: same (Type, EvalOrder) shared by 2+ active product rules ─

    @TestVisible
    static List<DetectorResult> evaluatePRD002(List<Map<String, Object>> rules) {
        Map<String, List<Map<String, Object>>> byKey = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Object orderObj = rule.get('SBQQ__EvaluationOrder__c');
            if (orderObj == null) continue;
            String key = typeOf(rule) + '|' + String.valueOf(Decimal.valueOf(String.valueOf(orderObj)).intValue());
            if (!byKey.containsKey(key)) byKey.put(key, new List<Map<String, Object>>());
            byKey.get(key).add(rule);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (String key : byKey.keySet()) {
            List<Map<String, Object>> bucket = byKey.get(key);
            if (bucket.size() < 2) continue;
            String[] parts = key.split('\\|');
            List<String> names = new List<String>();
            for (Map<String, Object> rule : bucket) names.add('"' + (String) rule.get('Name') + '"');
            DetectorResult r = new DetectorResult();
            r.detectorId = 'PRD-002';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = bucket.size() + ' ' + parts[0] + ' rules share evaluation order ' + parts[1];
            r.description = 'Rules ' + String.join(names, ', ') +
                ' are all ' + parts[0] + ' rules with evaluation order ' + parts[1] +
                '. When rules share the same order, execution sequence is unpredictable.';
            r.primaryRecord = asRef(bucket[0]);
            for (Integer i = 1; i < bucket.size(); i++) r.supportingRecords.add(asRef(bucket[i]));
            out.add(r);
        }
        return out;
    }

    // ── PRD-003: no conditions AND no actions ─────────────────────

    @TestVisible
    static List<DetectorResult> evaluatePRD003(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            Integer actionCount = actionsOf(rule).size();
            Integer errCondCount = errorConditionsCountOf(rule);
            if (actionCount > 0 || errCondCount > 0) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'PRD-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Product Rule "' + (String) rule.get('Name') + '" has no conditions or actions';
            r.description = '"' + (String) rule.get('Name') + '" (Type: ' + typeOf(rule) +
                ') is active but has neither error conditions nor actions configured. It does nothing.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    // ── PRD-004: Validation/Alert rule missing ConditionsMet ──────

    @TestVisible
    static List<DetectorResult> evaluatePRD004(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            String t = typeOf(rule);
            if (t != 'Validation' && t != 'Alert') continue;
            // Phase 22n — if the field wasn't returned (loose fallback
            // dropped it because the target lacks it), we cannot evaluate
            // — skip rather than treat null as "blank" and false-fire.
            if (!rule.containsKey('SBQQ__ConditionsMet__c')) continue;
            Object cm = rule.get('SBQQ__ConditionsMet__c');
            String cmStr = (cm == null) ? null : String.valueOf(cm);
            if (!String.isBlank(cmStr)) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'PRD-004';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            r.title = t + ' rule "' + (String) rule.get('Name') + '" missing condition logic';
            r.description = '"' + (String) rule.get('Name') + '" is a ' + t +
                ' rule but Conditions Met is not set ("All" or "Any"). Without this, the rule cannot properly evaluate when to trigger.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    /** Count rows in the SBQQ__ErrorConditions__r subquery. Returns 0 if
     *  the field/subquery is absent (older CPQ versions). */
    @TestVisible
    static Integer errorConditionsCountOf(Map<String, Object> rule) {
        Object o = rule.get('SBQQ__ErrorConditions__r');
        if (o == null) return 0;
        Object recs = ((Map<String, Object>) o).get('records');
        if (recs == null) return 0;
        return ((List<Object>) recs).size();
    }

    // â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    static Boolean isActive(Map<String, Object> r) {
        return Boolean.valueOf(r.get('SBQQ__Active__c'));
    }

    static String typeOf(Map<String, Object> r) {
        Object o = r.get('SBQQ__Type__c');
        return (o == null) ? null : String.valueOf(o);
    }

    @TestVisible
    static List<Map<String, Object>> actionsOf(Map<String, Object> rule) {
        Object o = rule.get('SBQQ__Actions__r');
        if (o == null) return new List<Map<String, Object>>();
        Object recs = ((Map<String, Object>) o).get('records');
        if (recs == null) return new List<Map<String, Object>>();
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object r : (List<Object>) recs) out.add((Map<String, Object>) r);
        return out;
    }

    static SourceRecord asRef(Map<String, Object> r) {
        return new SourceRecord('SBQQ__ProductRule__c', (Id) r.get('Id'), (String) r.get('Name'));
    }

    static final Set<String> SELECTION_ACTION_TYPES = new Set<String>{
        'Add', 'Remove', 'Enable & Add', 'Disable & Remove'
    };

    // â”€â”€ LQ-003: selection rule action with no target product and no LookupObject â”€

    @TestVisible
    static List<DetectorResult> evaluateLQ003(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            if (typeOf(rule) != 'Selection') continue;
            if (!String.isBlank((String) rule.get('SBQQ__LookupObject__c'))) continue;

            List<Map<String, Object>> missingProductActions = new List<Map<String, Object>>();
            for (Map<String, Object> act : actionsOf(rule)) {
                String at = (String) act.get('SBQQ__Type__c');
                if (!SELECTION_ACTION_TYPES.contains(at)) continue;
                if (act.get('SBQQ__Product__c') == null) missingProductActions.add(act);
            }
            if (missingProductActions.isEmpty()) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'LQ-003';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
            r.gapUsd = 0;
            r.recoverabilityScore = 0.9;
            String firstType = (String) missingProductActions[0].get('SBQQ__Type__c');
            r.title = 'Selection rule "' + (String) rule.get('Name') + '" has action without target product';
            r.description = '"' + (String) rule.get('Name') + '" has ' + missingProductActions.size() +
                ' selection action(s) of type "' + firstType +
                '" but no target product is specified and no lookup object is configured.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }

    // â”€â”€ LQ-004: selection rule action â†’ inactive product (one finding per action) â”€

    @TestVisible
    static List<DetectorResult> evaluateLQ004(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            if (typeOf(rule) != 'Selection') continue;
            for (Map<String, Object> act : actionsOf(rule)) {
                if (act.get('SBQQ__Product__c') == null) continue;
                Object prodObj = act.get('SBQQ__Product__r');
                if (prodObj == null) continue;
                Map<String, Object> prod = (Map<String, Object>) prodObj;
                Boolean active = Boolean.valueOf(prod.get('IsActive'));
                if (active) continue;
                String productName = (String) prod.get('Name');
                if (String.isBlank(productName)) productName = String.valueOf(act.get('SBQQ__Product__c'));
                String actType = (String) act.get('SBQQ__Type__c');
                DetectorResult r = new DetectorResult();
                r.detectorId = 'LQ-004';
                r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Warning');
                r.gapUsd = 0;
                r.recoverabilityScore = 0.9;
                r.title = 'Selection rule targets inactive product "' + productName + '"';
                r.description = '"' + (String) rule.get('Name') + '" has a "' + actType +
                    '" action targeting "' + productName + '" which is inactive.';
                r.primaryRecord = asRef(rule);
                out.add(r);
            }
        }
        return out;
    }

    // â”€â”€ LQ-005: selection rules with null EvalOrder (only when â‰¥2 selection rules) â”€

    @TestVisible
    static List<DetectorResult> evaluateLQ005(List<Map<String, Object>> rules) {
        Integer selectionRuleCount = 0;
        List<Map<String, Object>> missingOrder = new List<Map<String, Object>>();
        for (Map<String, Object> rule : rules) {
            if (!isActive(rule)) continue;
            if (typeOf(rule) != 'Selection') continue;
            selectionRuleCount++;
            if (rule.get('SBQQ__EvaluationOrder__c') == null) missingOrder.add(rule);
        }
        if (selectionRuleCount < 2) return new List<DetectorResult>();
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> rule : missingOrder) {
            DetectorResult r = new DetectorResult();
            r.detectorId = 'LQ-005';
            r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Info');
            r.gapUsd = 0;
            r.recoverabilityScore = 1.0;
            r.title = 'Selection rule "' + (String) rule.get('Name') + '" has no evaluation order';
            r.description = '"' + (String) rule.get('Name') +
                '" is an active selection rule without an explicit evaluation order.';
            r.primaryRecord = asRef(rule);
            out.add(r);
        }
        return out;
    }
}
