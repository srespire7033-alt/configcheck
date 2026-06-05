/**
 * Phase 22a-3 — Bundle of 6 checks on Product2 + SBQQ__ProductOption__c.
 *
 *   BN-001 — Empty bundles (ConfigurationType set, zero options)
 *   BN-002 — Option Min > Max quantity
 *   BN-003 — Bundles nested deeper than 3 levels
 *   BN-004 — Required options missing active PricebookEntry
 *   BN-005 — Bundles with 5+ options and no feature grouping
 *   BN-006 — Bundle mixes Evergreen + Renewable subscription types
 *
 * SOQL budget: 3 queries (Product2, ProductOption, PricebookEntry).
 * Surface gate: SBQQ__ProductOption__c is the canonical CPQ-namespace
 * proxy. Without it nothing in this bundle is meaningful.
 */
public with sharing class BundleIntegrityChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubProducts;
    @TestVisible static List<Map<String, Object>> testStubOptions;
    @TestVisible static Set<Id> testStubPricebookProductIds;

    public String getDetectorId() { return 'BN-BUNDLE'; }
    public String getLabel() { return 'Bundle integrity checks'; }
    public Set<String> getAppliesTo() {
        return new Set<String>{ 'CPQ', 'CPQ+Billing' };
    }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        List<Map<String, Object>> products;
        List<Map<String, Object>> options;
        Set<Id> pbeProductIds;

        if (testStubProducts != null || testStubOptions != null || testStubPricebookProductIds != null) {
            products = (testStubProducts != null) ? testStubProducts : new List<Map<String, Object>>();
            options = (testStubOptions != null) ? testStubOptions : new List<Map<String, Object>>();
            pbeProductIds = (testStubPricebookProductIds != null) ? testStubPricebookProductIds : new Set<Id>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__ProductOption__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] BN-BUNDLE: SBQQ__ProductOption__c not present.');
                return results;
            }
            // Active products with subscription/configuration metadata.
            // SBQQ__SubscriptionType__c / SBQQ__ConfigurationType__c may
            // not exist in older CPQ versions — guard with SchemaUtil.
            Boolean hasSubType = SchemaUtil.hasField('Product2', 'SBQQ__SubscriptionType__c');
            Boolean hasConfigType = SchemaUtil.hasField('Product2', 'SBQQ__ConfigurationType__c');
            String pSelect = 'SELECT Id, Name, IsActive'
                + (hasConfigType ? ', SBQQ__ConfigurationType__c' : '')
                + (hasSubType    ? ', SBQQ__SubscriptionType__c'  : '')
                + ' FROM Product2 WHERE IsActive = true LIMIT 5000';
            try { products = OrgQueryService.query(ctx, pSelect); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] BN-BUNDLE products: ' + e.getMessage());
                return results;
            }
            // Options — include relationships needed by all 6 checks.
            String oSelect =
                'SELECT Id, Name, SBQQ__ConfiguredSKU__c, SBQQ__OptionalSKU__c, ' +
                '  SBQQ__Required__c, SBQQ__MinQuantity__c, SBQQ__MaxQuantity__c, ' +
                '  SBQQ__Feature__c, ' +
                '  SBQQ__ConfiguredSKU__r.Name, ' +
                '  SBQQ__OptionalSKU__r.Name, SBQQ__OptionalSKU__r.IsActive ' +
                'FROM SBQQ__ProductOption__c LIMIT 10000';
            try { options = OrgQueryService.query(ctx, oSelect); }
            catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] BN-BUNDLE options: ' + e.getMessage());
                return results;
            }
            // PricebookEntry — Product2Id set of all active PBE.
            pbeProductIds = new Set<Id>();
            try {
                for (Map<String, Object> row : OrgQueryService.query(ctx,
                    'SELECT Product2Id FROM PricebookEntry WHERE IsActive = true LIMIT 50000')) {
                    Object pid = row.get('Product2Id');
                    if (pid != null) pbeProductIds.add((Id) pid);
                }
            } catch (Exception e) { /* PBE missing is unusual — fall through */ }
        }

        Boolean runBN001 = DetectorCatalogController.isActive('BN-001');
        Boolean runBN002 = DetectorCatalogController.isActive('BN-002');
        Boolean runBN003 = DetectorCatalogController.isActive('BN-003');
        Boolean runBN004 = DetectorCatalogController.isActive('BN-004');
        Boolean runBN005 = DetectorCatalogController.isActive('BN-005');
        Boolean runBN006 = DetectorCatalogController.isActive('BN-006');

        if (runBN001) results.addAll(evaluateBN001(products, options));
        if (runBN002) results.addAll(evaluateBN002(options));
        if (runBN003) results.addAll(evaluateBN003(products, options));
        if (runBN004) results.addAll(evaluateBN004(options, pbeProductIds));
        if (runBN005) results.addAll(evaluateBN005(options));
        if (runBN006) results.addAll(evaluateBN006(products, options));
        return results;
    }

    // ── helpers ────────────────────────────────────────────────────

    static String s(Map<String, Object> m, String key) {
        Object o = m.get(key);
        return (o == null) ? null : String.valueOf(o);
    }

    static SourceRecord prodRef(Map<String, Object> p) {
        return new SourceRecord('Product2', (Id) p.get('Id'), (String) p.get('Name'));
    }

    static SourceRecord optRef(Map<String, Object> o) {
        return new SourceRecord('SBQQ__ProductOption__c', (Id) o.get('Id'), (String) o.get('Name'));
    }

    /** Pulls a nested relationship Map (e.g. SBQQ__OptionalSKU__r). Null-safe. */
    static Map<String, Object> nested(Map<String, Object> m, String rel) {
        Object o = m.get(rel);
        if (o == null || !(o instanceof Map<String, Object>)) return new Map<String, Object>();
        return (Map<String, Object>) o;
    }

    // ── BN-001: bundle has ConfigurationType but no options ────────

    @TestVisible
    static List<DetectorResult> evaluateBN001(List<Map<String, Object>> products, List<Map<String, Object>> options) {
        Set<Id> bundlesWithOptions = new Set<Id>();
        for (Map<String, Object> opt : options) {
            Object cs = opt.get('SBQQ__ConfiguredSKU__c');
            if (cs != null) bundlesWithOptions.add((Id) cs);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> p : products) {
            String cfgType = s(p, 'SBQQ__ConfigurationType__c');
            if (String.isBlank(cfgType)) continue;
            Id pid = (Id) p.get('Id');
            if (bundlesWithOptions.contains(pid)) continue;
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-001';
            r.severity = 'Critical';
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Empty bundle "' + (String) p.get('Name') + '"';
            r.description = '"' + (String) p.get('Name') + '" has Configuration Type = "' + cfgType +
                '" but has zero product options. The configurator will open with a blank page.';
            r.primaryRecord = prodRef(p);
            out.add(r);
        }
        return out;
    }

    // ── BN-002: Min > Max quantity ─────────────────────────────────

    @TestVisible
    static List<DetectorResult> evaluateBN002(List<Map<String, Object>> options) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> opt : options) {
            Object minObj = opt.get('SBQQ__MinQuantity__c');
            Object maxObj = opt.get('SBQQ__MaxQuantity__c');
            if (minObj == null || maxObj == null) continue;
            Decimal mn = Decimal.valueOf(String.valueOf(minObj));
            Decimal mx = Decimal.valueOf(String.valueOf(maxObj));
            if (mn <= mx) continue;
            String parentName = (String) nested(opt, 'SBQQ__ConfiguredSKU__r').get('Name');
            String childName = (String) nested(opt, 'SBQQ__OptionalSKU__r').get('Name');
            if (String.isBlank(parentName)) parentName = 'Unknown Bundle';
            if (String.isBlank(childName)) childName = 'Unknown Product';
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-002';
            r.severity = 'Warning';
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Option quantity mismatch on "' + childName + '"';
            r.description = 'Product option "' + (String) opt.get('Name') + '" in bundle "' + parentName +
                '" has Min Quantity (' + mn + ') greater than Max Quantity (' + mx +
                '). Users cannot satisfy both constraints simultaneously.';
            r.primaryRecord = optRef(opt);
            out.add(r);
        }
        return out;
    }

    // ── BN-003: bundles nested deeper than 3 ──────────────────────

    @TestVisible
    static List<DetectorResult> evaluateBN003(List<Map<String, Object>> products, List<Map<String, Object>> options) {
        // childrenOf: parentId -> List<childId>
        Map<Id, List<Id>> childrenOf = new Map<Id, List<Id>>();
        Set<Id> allChildren = new Set<Id>();
        for (Map<String, Object> opt : options) {
            Object pObj = opt.get('SBQQ__ConfiguredSKU__c');
            Object cObj = opt.get('SBQQ__OptionalSKU__c');
            if (pObj == null || cObj == null) continue;
            Id pid = (Id) pObj;
            Id cid = (Id) cObj;
            if (!childrenOf.containsKey(pid)) childrenOf.put(pid, new List<Id>());
            childrenOf.get(pid).add(cid);
            allChildren.add(cid);
        }
        // Top bundles: parents that aren't anyone's child.
        Map<Id, String> nameById = new Map<Id, String>();
        for (Map<String, Object> p : products) nameById.put((Id) p.get('Id'), (String) p.get('Name'));

        List<DetectorResult> out = new List<DetectorResult>();
        for (Id parent : childrenOf.keySet()) {
            if (allChildren.contains(parent)) continue;
            // BFS, cap at depth=4 (we only care depth > 3).
            Integer depth = bfsMaxDepth(parent, childrenOf, 4);
            if (depth <= 3) continue;
            String name = nameById.containsKey(parent) ? nameById.get(parent) : String.valueOf(parent);
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-003';
            r.severity = 'Warning';
            r.gapUsd = 0;
            r.recoverabilityScore = 0.7;
            r.title = 'Bundle "' + name + '" nested ' + depth + ' levels deep';
            r.description = '"' + name + '" has a nesting depth of ' + depth +
                ' levels. CPQ performance degrades beyond 3 levels and the configurator UX becomes confusing.';
            r.primaryRecord = new SourceRecord('Product2', parent, name);
            out.add(r);
        }
        return out;
    }

    static Integer bfsMaxDepth(Id root, Map<Id, List<Id>> childrenOf, Integer cap) {
        Set<Id> visited = new Set<Id>{ root };
        Integer maxDepth = 1;
        // Frontier of (id, depth) — kept as parallel lists to avoid an inner-class.
        List<Id> frontierIds = new List<Id>{ root };
        List<Integer> frontierDepths = new List<Integer>{ 1 };
        while (!frontierIds.isEmpty()) {
            Id cur = frontierIds.remove(0);
            Integer d = frontierDepths.remove(0);
            if (d >= cap) return d;
            List<Id> kids = childrenOf.get(cur);
            if (kids == null) continue;
            for (Id k : kids) {
                if (visited.contains(k)) continue;
                visited.add(k);
                Integer newDepth = d + 1;
                if (newDepth > maxDepth) maxDepth = newDepth;
                if (newDepth >= cap) return newDepth;
                frontierIds.add(k);
                frontierDepths.add(newDepth);
            }
        }
        return maxDepth;
    }

    // ── BN-004: Required option missing PricebookEntry ────────────

    @TestVisible
    static List<DetectorResult> evaluateBN004(List<Map<String, Object>> options, Set<Id> pbeProductIds) {
        List<DetectorResult> out = new List<DetectorResult>();
        for (Map<String, Object> opt : options) {
            if (!Boolean.valueOf(opt.get('SBQQ__Required__c'))) continue;
            Object cObj = opt.get('SBQQ__OptionalSKU__c');
            if (cObj == null) continue;
            Map<String, Object> childRef = nested(opt, 'SBQQ__OptionalSKU__r');
            Object activeObj = childRef.get('IsActive');
            if (activeObj != null && Boolean.valueOf(activeObj) == false) continue;
            if (pbeProductIds.contains((Id) cObj)) continue;
            String parentName = (String) nested(opt, 'SBQQ__ConfiguredSKU__r').get('Name');
            String childName = (String) childRef.get('Name');
            if (String.isBlank(parentName)) parentName = 'Unknown Bundle';
            if (String.isBlank(childName)) childName = 'Unknown Product';
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-004';
            r.severity = 'Critical';
            r.gapUsd = 0;
            r.recoverabilityScore = 0.95;
            r.title = 'Required option "' + childName + '" has no price book entry';
            r.description = 'Bundle "' + parentName + '" requires option "' + childName +
                '" but the product has no active price book entry. The bundle will fail when added to a quote.';
            r.primaryRecord = optRef(opt);
            out.add(r);
        }
        return out;
    }

    // ── BN-005: 5+ options, none feature-grouped ──────────────────

    @TestVisible
    static List<DetectorResult> evaluateBN005(List<Map<String, Object>> options) {
        Map<Id, List<Map<String, Object>>> byBundle = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> opt : options) {
            Object pObj = opt.get('SBQQ__ConfiguredSKU__c');
            if (pObj == null) continue;
            Id pid = (Id) pObj;
            if (!byBundle.containsKey(pid)) byBundle.put(pid, new List<Map<String, Object>>());
            byBundle.get(pid).add(opt);
        }
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id pid : byBundle.keySet()) {
            List<Map<String, Object>> opts = byBundle.get(pid);
            if (opts.size() < 5) continue;
            Boolean allUngrouped = true;
            for (Map<String, Object> o : opts) {
                if (o.get('SBQQ__Feature__c') != null) { allUngrouped = false; break; }
            }
            if (!allUngrouped) continue;
            String parentName = (String) nested(opts[0], 'SBQQ__ConfiguredSKU__r').get('Name');
            if (String.isBlank(parentName)) parentName = String.valueOf(pid);
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-005';
            r.severity = 'Info';
            r.gapUsd = 0;
            r.recoverabilityScore = 1.0;
            r.title = 'Bundle "' + parentName + '" has ' + opts.size() + ' options without feature grouping';
            r.description = '"' + parentName + '" has ' + opts.size() +
                ' product options but none are organized into features. Feature grouping improves configurator UX.';
            r.primaryRecord = new SourceRecord('Product2', pid, parentName);
            out.add(r);
        }
        return out;
    }

    // ── BN-006: bundle mixes Evergreen + Renewable ────────────────

    @TestVisible
    static List<DetectorResult> evaluateBN006(List<Map<String, Object>> products, List<Map<String, Object>> options) {
        // Subscription type by product id.
        Map<Id, String> subTypeByProduct = new Map<Id, String>();
        for (Map<String, Object> p : products) {
            String st = s(p, 'SBQQ__SubscriptionType__c');
            if (!String.isBlank(st)) subTypeByProduct.put((Id) p.get('Id'), st.toLowerCase());
        }
        if (subTypeByProduct.isEmpty()) return new List<DetectorResult>();
        Map<Id, List<String>> ergByBundle = new Map<Id, List<String>>();
        Map<Id, List<String>> renByBundle = new Map<Id, List<String>>();
        for (Map<String, Object> opt : options) {
            Object pObj = opt.get('SBQQ__ConfiguredSKU__c');
            Object cObj = opt.get('SBQQ__OptionalSKU__c');
            if (pObj == null || cObj == null) continue;
            String subType = subTypeByProduct.get((Id) cObj);
            if (subType == null) continue;
            Id parentId = (Id) pObj;
            String childName = (String) nested(opt, 'SBQQ__OptionalSKU__r').get('Name');
            if (String.isBlank(childName)) childName = String.valueOf(cObj);
            if (subType == 'evergreen') {
                if (!ergByBundle.containsKey(parentId)) ergByBundle.put(parentId, new List<String>());
                ergByBundle.get(parentId).add(childName);
            } else if (subType == 'renewable') {
                if (!renByBundle.containsKey(parentId)) renByBundle.put(parentId, new List<String>());
                renByBundle.get(parentId).add(childName);
            }
        }
        Map<Id, String> nameById = new Map<Id, String>();
        for (Map<String, Object> p : products) nameById.put((Id) p.get('Id'), (String) p.get('Name'));
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id pid : ergByBundle.keySet()) {
            if (!renByBundle.containsKey(pid)) continue;
            String name = nameById.containsKey(pid) ? nameById.get(pid) : String.valueOf(pid);
            List<String> ergSample = sample3(ergByBundle.get(pid));
            List<String> renSample = sample3(renByBundle.get(pid));
            DetectorResult r = new DetectorResult();
            r.detectorId = 'BN-006';
            r.severity = 'Critical';
            r.gapUsd = 0;
            r.recoverabilityScore = 0.8;
            r.title = 'Bundle "' + name + '" mixes Evergreen and Renewable subscriptions';
            r.description = 'Bundle "' + name + '" contains options with both Evergreen subscription type (' +
                String.join(ergSample, ', ') +
                (ergByBundle.get(pid).size() > 3 ? ', +' + (ergByBundle.get(pid).size() - 3) + ' more' : '') +
                ') and Renewable subscription type (' +
                String.join(renSample, ', ') +
                (renByBundle.get(pid).size() > 3 ? ', +' + (renByBundle.get(pid).size() - 3) + ' more' : '') +
                '). CPQ does not support this combination — bundles must be all-Evergreen or all-Renewable.';
            r.primaryRecord = new SourceRecord('Product2', pid, name);
            out.add(r);
        }
        return out;
    }

    static List<String> sample3(List<String> all) {
        List<String> out = new List<String>();
        Integer cap = Math.min(3, all.size());
        for (Integer i = 0; i < cap; i++) out.add(all[i]);
        return out;
    }
}
