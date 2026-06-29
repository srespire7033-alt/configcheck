/**
 * Approval Rule health checks. Prefers Advanced Approvals (sbaa) namespace
 * when installed, falls back to legacy CPQ (SBQQ) approval rules otherwise.
 *
 *   AR-001 — Active rule with no Approver and no ApproverField (critical)
 *   AR-002 — Active rule with no conditions (warning)
 *   AR-003 — Duplicate EvaluationOrder (warning, SBQQ-only — sbaa has no equivalent field)
 *   AR-004 — Has conditions but missing ConditionsMet (warning)
 *   AR-005 — Inactive rules cleanup (info, aggregated)
 *   AR-006 — Active rule never invoked in last 90 days (warning, deal-desk-dead signal)
 */
public with sharing class ApprovalRuleChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubRows;
    /** Phase 25+ — Map<ruleId, recentApprovalCount> for AR-006. */
    @TestVisible static Map<Id, Integer> testStubApprovalCounts;

    public String getDetectorId() { return 'AR-BUNDLE'; }
    public String getLabel() { return 'Approval Rule health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> rows;
        // Resolved package prefix ("sbaa" or "SBQQ"). Stored on stub for tests.
        String pkg;
        if (testStubRows != null) {
            rows = testStubRows;
            pkg = 'SBQQ';
        } else {
            pkg = resolveApprovalPackage(ctx);
            if (pkg == null) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] AR-BUNDLE: neither sbaa__ApprovalRule__c nor SBQQ__ApprovalRule__c present.');
                return results;
            }
            String soql = buildSoql(pkg);
            try { rows = OrgQueryService.query(ctx, soql); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AR-BUNDLE: ' + e.getMessage());
                return results;
            }
            // Normalize sbaa-prefixed keys to SBQQ form so the evaluate* methods
            // can stay package-agnostic. Lossless rename — keeps original IDs/values.
            if (pkg == 'sbaa') rows = normalizeKeys(rows);
        }

        Boolean runAR003 = DetectorCatalogController.isActive('AR-003');
        Boolean runAR004 = DetectorCatalogController.isActive('AR-004');
        Boolean runAR005 = DetectorCatalogController.isActive('AR-005');
        Boolean runAR006 = DetectorCatalogController.isActive('AR-006');

        // AR-001 migrated to CustomDetector__mdt (Phase 24f pilot).
        // AR-002 migrated to CustomDetector__mdt (Phase 24h).
        // AR-003: sbaa has no EvaluationOrder field — chain steps handle ordering instead.
        if (runAR003 && pkg == 'SBQQ') results.addAll(evaluateAR003(rows));
        if (runAR004) results.addAll(evaluateAR004(rows, pkg));
        if (runAR005) results.addAll(evaluateAR005(rows, pkg));
        if (runAR006) {
            Map<Id, Integer> approvalCounts = (testStubApprovalCounts != null)
                ? testStubApprovalCounts
                : fetchApprovalCounts(ctx, rows, pkg);
            results.addAll(evaluateAR006(rows, approvalCounts, pkg));
        }
        return results;
    }

    /** Fetch count of sbaa__Approval__c / SBQQ__Approval__c per rule
     *  created in the last 90 days. Empty map on any failure. */
    static Map<Id, Integer> fetchApprovalCounts(DetectorContext ctx, List<Map<String, Object>> rules, String pkg) {
        Map<Id, Integer> out = new Map<Id, Integer>();
        if (rules == null || rules.isEmpty()) return out;
        Set<Id> ruleIds = new Set<Id>();
        for (Map<String, Object> r : rules) {
            Object idVal = r.get('Id');
            if (idVal != null) ruleIds.add((Id) idVal);
        }
        if (ruleIds.isEmpty()) return out;
        List<String> quoted = new List<String>();
        for (Id id : ruleIds) quoted.add('\'' + String.valueOf(id) + '\'');
        // sbaa: sbaa__Approval__c.sbaa__ApprovalRule__c
        // SBQQ: SBQQ__Approval__c.SBQQ__ApprovalRule__c
        String approvalObj = pkg + '__Approval__c';
        String ruleField = pkg + '__ApprovalRule__c';
        String soql = 'SELECT ' + ruleField + ' ruleId, COUNT(Id) cnt ' +
            'FROM ' + approvalObj + ' ' +
            'WHERE ' + ruleField + ' IN (' + String.join(quoted, ',') + ') ' +
            '  AND CreatedDate = LAST_N_DAYS:90 ' +
            'GROUP BY ' + ruleField;
        try {
            for (Map<String, Object> agg : OrgQueryService.query(ctx, soql)) {
                Object rid = agg.get('ruleId');
                Object c = agg.get('cnt');
                if (rid != null && c != null) out.put((Id) rid, Integer.valueOf(c));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] AR-006 approvalCounts: ' + e.getMessage());
        }
        return out;
    }

    static String resolveApprovalPackage(DetectorContext ctx) {
        if (ctx != null && ctx.isRemote()) {
            if (OrgQueryService.remoteSObjectExists(ctx.namedCredentialName, 'sbaa__ApprovalRule__c')) return 'sbaa';
            if (OrgQueryService.remoteSObjectExists(ctx.namedCredentialName, 'SBQQ__ApprovalRule__c')) return 'SBQQ';
            return null;
        }
        if (SchemaUtil.hasObject('sbaa__ApprovalRule__c')) return 'sbaa';
        if (SchemaUtil.hasObject('SBQQ__ApprovalRule__c')) return 'SBQQ';
        return null;
    }

    static String buildSoql(String pkg) {
        // sbaa rules don't have EvaluationOrder; SBQQ rules do.
        String fields = 'Id, Name, CreatedDate, ' + pkg + '__Active__c, '
            + pkg + '__Approver__c, ' + pkg + '__ApproverField__c, ' + pkg + '__ConditionsMet__c';
        if (pkg == 'SBQQ') fields += ', SBQQ__EvaluationOrder__c';
        String subquery = '(SELECT Id FROM ' + pkg + '__ApprovalConditions__r LIMIT 100)';
        return 'SELECT ' + fields + ', ' + subquery + ' FROM ' + pkg + '__ApprovalRule__c LIMIT 5000';
    }

    /** Rename sbaa__ keys → SBQQ__ keys so evaluate* methods stay namespace-blind. */
    static List<Map<String, Object>> normalizeKeys(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> n = new Map<String, Object>();
            for (String k : r.keySet()) {
                String nk = k.startsWith('sbaa__') ? 'SBQQ__' + k.substring(6) : k;
                n.put(nk, r.get(k));
            }
            out.add(n);
        }
        return out;
    }

    static Boolean isActive(Map<String, Object> r) { return Boolean.valueOf(r.get('SBQQ__Active__c')); }
    static Integer conditionCountOf(Map<String, Object> r) {
        Object o = r.get('SBQQ__ApprovalConditions__r');
        if (o == null) return 0;
        Object recs = ((Map<String, Object>) o).get('records');
        return (recs == null) ? 0 : ((List<Object>) recs).size();
    }
    static SourceRecord ref(Map<String, Object> r, String pkg) {
        String objName = (pkg == 'sbaa') ? 'sbaa__ApprovalRule__c' : 'SBQQ__ApprovalRule__c';
        return new SourceRecord(objName, (Id) r.get('Id'), (String) r.get('Name'));
    }

    @TestVisible
    static List<DetectorResult> evaluateAR001(List<Map<String, Object>> rules) {
        // Retained for backwards-compatible tests; AR-001 now driven by CustomDetector__mdt.
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (r.get('SBQQ__Approver__c') != null) continue;
            Object af = r.get('SBQQ__ApproverField__c');
            if (af != null && !String.isBlank(String.valueOf(af))) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" has no approver';
            dr.description = '"' + (String) r.get('Name') + '" is active but has neither Approver nor Approver Field. Quotes hitting this rule will have no one to approve them.';
            dr.primaryRecord = ref(r, 'SBQQ');
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR002(List<Map<String, Object>> rules) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            if (conditionCountOf(r) > 0) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" has no conditions';
            dr.description = '"' + (String) r.get('Name') + '" is active but has no conditions. Every quote may trigger this rule regardless of criteria.';
            dr.primaryRecord = ref(r, 'SBQQ');
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR003(List<Map<String, Object>> rules) {
        Map<Integer, List<Map<String, Object>>> byOrder = new Map<Integer, List<Map<String, Object>>>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Object o = r.get('SBQQ__EvaluationOrder__c');
            if (o == null) continue;
            Integer evalOrder = Decimal.valueOf(String.valueOf(o)).intValue();
            if (!byOrder.containsKey(evalOrder)) byOrder.put(evalOrder, new List<Map<String, Object>>());
            byOrder.get(evalOrder).add(r);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Integer evalOrder : byOrder.keySet()) {
            List<Map<String, Object>> bucket = byOrder.get(evalOrder);
            if (bucket.size() < 2) continue;
            List<String> names = new List<String>();
            for (Map<String, Object> r : bucket) names.add('"' + (String) r.get('Name') + '"');
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = bucket.size() + ' approval rules share evaluation order ' + evalOrder;
            dr.description = 'Rules ' + String.join(names, ', ') + ' all have evaluation order ' + evalOrder + '. Execution sequence is unpredictable.';
            dr.primaryRecord = ref(bucket[0], 'SBQQ');
            for (Integer i = 1; i < bucket.size(); i++) dr.supportingRecords.add(ref(bucket[i], 'SBQQ'));
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR004(List<Map<String, Object>> rules) {
        return evaluateAR004(rules, 'SBQQ');
    }
    static List<DetectorResult> evaluateAR004(List<Map<String, Object>> rules, String pkg) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Integer condCount = conditionCountOf(r);
            if (condCount == 0) continue;
            Object cm = r.get('SBQQ__ConditionsMet__c');
            if (cm != null && !String.isBlank(String.valueOf(cm))) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" missing Conditions Met logic';
            dr.description = '"' + (String) r.get('Name') + '" has ' + condCount + ' condition(s) but Conditions Met is not set ("All" or "Any").';
            dr.primaryRecord = ref(r, pkg);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateAR005(List<Map<String, Object>> rules) {
        return evaluateAR005(rules, 'SBQQ');
    }
    static List<DetectorResult> evaluateAR005(List<Map<String, Object>> rules, String pkg) {
        List<Map<String, Object>> inactives = new List<Map<String, Object>>();
        for (Map<String, Object> r : rules) if (!isActive(r)) inactives.add(r);
        if (inactives.isEmpty()) return new List<DetectorResult>();
        List<String> sample = new List<String>();
        Integer sampleCap = Math.min(5, inactives.size());
        for (Integer i = 0; i < sampleCap; i++) sample.add('"' + (String) inactives[i].get('Name') + '"');
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'AR-005'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = inactives.size() + ' inactive approval rule(s)';
        dr.description = inactives.size() + ' approval rule(s) are deactivated: ' + String.join(sample, ', ') +
            (inactives.size() > 5 ? ' and ' + (inactives.size() - 5) + ' more.' : '.');
        dr.primaryRecord = ref(inactives[0], pkg);
        Integer cap = Math.min(10, inactives.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(ref(inactives[i], pkg));
        return new List<DetectorResult>{ dr };
    }

    // ── AR-006: Active rule never invoked in last 90 days ─────────
    //
    // PP-19 signature: "deal desk approval not functional — no system
    // mechanism validates deal-desk-level deals." Rule looks healthy
    // (active, has approver, has conditions) but never fires. We only
    // flag rules that have existed > 90 days — newer rules legitimately
    // may not have had time to be triggered.
    @TestVisible
    static List<DetectorResult> evaluateAR006(List<Map<String, Object>> rules, Map<Id, Integer> approvalCounts) {
        return evaluateAR006(rules, approvalCounts, 'SBQQ');
    }
    static List<DetectorResult> evaluateAR006(List<Map<String, Object>> rules, Map<Id, Integer> approvalCounts, String pkg) {
        List<DetectorResult> out = new List<DetectorResult>();
        if (approvalCounts == null) approvalCounts = new Map<Id, Integer>();
        Date cutoff = Date.today().addDays(-90);
        for (Map<String, Object> r : rules) {
            if (!isActive(r)) continue;
            Id ruleId = (Id) r.get('Id');
            if (ruleId == null) continue;
            // Skip rules that are too new to expect invocations.
            Object cdRaw = r.get('CreatedDate');
            Date createdDate;
            if (cdRaw instanceof Datetime) createdDate = ((Datetime) cdRaw).date();
            else if (cdRaw instanceof Date) createdDate = (Date) cdRaw;
            else if (cdRaw instanceof String) {
                try { createdDate = Datetime.valueOf((String) cdRaw).date(); }
                catch (Exception e) {
                    try { createdDate = Date.valueOf(((String) cdRaw).substring(0, 10)); }
                    catch (Exception e2) {}
                }
            }
            if (createdDate == null || createdDate > cutoff) continue;
            Integer count = approvalCounts.containsKey(ruleId) ? approvalCounts.get(ruleId) : 0;
            if (count > 0) continue;

            Integer ageDays = createdDate.daysBetween(Date.today());
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'AR-006';
            dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning');
            dr.gapUsd = 0;
            dr.recoverabilityScore = 0.7;
            dr.title = 'Approval rule "' + (String) r.get('Name') + '" never invoked in 90 days';
            dr.description = '"' + (String) r.get('Name') + '" is active and has existed for ' +
                ageDays + ' days, but no ' + pkg + '__Approval__c records have been created against ' +
                'it in the last 90 days. Either the rule conditions never match real quotes (dead ' +
                'rule), the approval matrix routes around it, or the deal desk gate is silently ' +
                'broken. Verify the rule fires against a representative quote.';
            dr.primaryRecord = ref(r, pkg);
            out.add(dr);
        }
        return out;
    }
}
