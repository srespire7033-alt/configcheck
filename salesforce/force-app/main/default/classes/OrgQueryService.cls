/**
 * Phase 7+ — single SOQL abstraction layer.
 *
 * Detectors call OrgQueryService.query(ctx, soql) instead of
 * Database.query() directly. The service inspects ctx.isRemote()
 * and either:
 *   - LOCAL  → Database.query(soql), then flatten each row to its
 *              field map via getPopulatedFieldsAsMap(). The host
 *              org must have CPQ installed to use this path —
 *              it exists primarily as a "scan host org for demo
 *              data" mode against the development org.
 *   - REMOTE → HTTP callout via `callout:NamedCred/services/data/.../query/`,
 *              parses the records JSON straight to Map<String,Object>.
 *              This is the production path. The host org does NOT
 *              need CPQ installed; the SBQQ__ types only appear
 *              inside the SOQL string sent to the remote.
 *
 * Both paths return List<Map<String, Object>> — typed SObject is
 * deliberately avoided so the host org never has a compile-time
 * dependency on CPQ/Billing/ARM schemas. Detectors consume the
 * maps directly. Nested relationships (`SBQQ__Quote__r`) appear as
 * nested Maps from JSON or as nested SObjects locally; the
 * normalize step downgrades the local case to Maps for consistency.
 */
public with sharing class OrgQueryService {

    @TestVisible static String API_VERSION = 'v60.0';
    // Phase 26 — 20s per callout. At 120s a single slow callout could burn the
    // entire 120s CUMULATIVE per-transaction callout budget, starving every
    // detector query that follows it.
    private static final Integer CALLOUT_TIMEOUT_MS = 20000;

    public class OrgQueryException extends Exception {}

    /**
     * Phase 24z — Remote schema probe cache.
     *
     * Keyed by Named Credential name → Set of SObject API names present on
     * that remote org, RESTRICTED to surfacesOfInterest() (Phase 26 — it used
     * to be every SObject in the org, which blew the heap). Loaded lazily with
     * a single targeted EntityDefinition /query and pinned for the rest of the
     * transaction so 200+ detector gating checks share one callout.
     *
     * A null value (vs an empty Set) is the "probe failed" sentinel —
     * callers treat it as "don't know, allow the detector to run rather
     * than silently hide it" to preserve current behavior on auth/network
     * issues. A non-null empty Set means "probe succeeded but org has no
     * SObjects we recognize" (effectively never, but valid).
     */
    @TestVisible private static Map<String, Set<String>> remoteSObjectCache = new Map<String, Set<String>>();

    /**
     * Phase 26 — the exact set of names we ASKED EntityDefinition about,
     * per Named Credential. getRemoteSObjectNames no longer returns every
     * SObject in the remote org (that payload blew the Apex heap — see
     * below), so "absent from the returned Set" is only meaningful for
     * names we actually queried. remoteSObjectExists uses this to fail
     * open for anything outside the asked-for union.
     */
    @TestVisible private static Map<String, Set<String>> requestedNameCache = new Map<String, Set<String>>();

    /**
     * Phase 26 — every SObject API name OrgPrism needs to gate on, built at
     * runtime (never hardcoded — RequiredSurface__c is customer-editable
     * metadata). Union of: product-type marker objects, approval-package
     * markers, OrgCapabilityProbeService's FIELDS_OF_INTEREST keys, and
     * every token in Detector__mdt.RequiredSurface__c.
     */
    @TestVisible
    static Set<String> surfacesOfInterest() {
        Set<String> want = new Set<String>{
            'SBQQ__Quote__c', 'blng__BillingRule__c', 'ProductSellingModel',
            'sbaa__ApprovalRule__c', 'SBQQ__ApprovalRule__c'
        };
        want.addAll(OrgCapabilityProbeService.probeSObjects());
        for (Detector__mdt d : [SELECT RequiredSurface__c FROM Detector__mdt WHERE RequiredSurface__c != null]) {
            for (String t : d.RequiredSurface__c.split(';')) {
                if (String.isNotBlank(t.trim())) want.add(t.trim());
            }
        }
        return want;
    }

    /**
     * Phase 26 — Returns the Set of SObject API names, FROM OUR
     * SURFACES-OF-INTEREST LIST, that exist on the remote org behind the
     * given Named Credential; null if the probe failed. Cached per-tx.
     * Caller should treat null as "fail open" (don't gate detectors out).
     *
     * Phase 26 rewrite (heap fix): this used to GET /services/data/vXX/sobjects/
     * — the remote org's ENTIRE sObject catalog — and JSON.deserializeUntyped
     * the whole body, holding the raw String and the parsed object graph live
     * at once. Measured bodies: 1.5 MB on a dev-ed org, 4.6 MB on a large
     * production org. Apex Strings are UTF-16, so on a big org that String
     * alone exceeded the 6 MB synchronous heap before parsing even began.
     * The resulting "Apex heap size too large" is a System.LimitException,
     * which is UNCATCHABLE — it killed the entire connect transaction before
     * ConnectedOrg__c was ever saved, so an org that authenticated perfectly
     * still showed as failed. Replaced with one targeted EntityDefinition
     * query: ~2 KB, flat, independent of remote org size.
     */
    public static Set<String> getRemoteSObjectNames(String namedCredentialName) {
        if (String.isBlank(namedCredentialName)) return null;
        if (remoteSObjectCache.containsKey(namedCredentialName)) {
            return remoteSObjectCache.get(namedCredentialName);
        }
        Set<String> want = surfacesOfInterest();
        Set<String> names = null;
        try {
            List<String> quoted = new List<String>();
            for (String s : want) quoted.add('\'' + String.escapeSingleQuotes(s) + '\'');
            // EntityDefinition does not support queryMore() — always LIMIT.
            String soql = 'SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN ('
                        + String.join(quoted, ',') + ') LIMIT 2000';
            names = new Set<String>();
            for (Map<String, Object> r : remoteQuery(namedCredentialName, soql)) {
                Object n = r.get('QualifiedApiName');
                if (n instanceof String && String.isNotBlank((String) n)) {
                    names.add((String) n);
                }
            }
        } catch (Exception e) {
            // remoteQuery THROWS on non-200 where the old inline callout returned
            // null. Restore the null "probe failed" sentinel so callers still fail
            // open instead of gating every detector off on a transient error.
            names = null;
            System.debug(LoggingLevel.WARN,
                '[OrgPrism] Schema probe failed for ' + namedCredentialName + ': ' + e.getMessage());
        }
        remoteSObjectCache.put(namedCredentialName, names);
        requestedNameCache.put(namedCredentialName, (names == null) ? null : want);
        return names;
    }

    /**
     * Phase 24z — Does the remote org have this SObject? Null cred or
     * blank objName → true (no surface requirement to gate on). Probe
     * failure → true (fail open — surface a detector we're unsure about
     * rather than silently hide it). Probe succeeded + name absent → false.
     */
    /**
     * Phase 24z-D — Auto-detect installed packages on the remote org.
     *
     * Reads the same per-tx schema probe cache that 24z-A populates and
     * returns the highest product tier the target actually has:
     *   - "ARM"          — ProductSellingModel present (with or without CPQ/Billing)
     *   - "CPQ+Billing"  — SBQQ__Quote__c + blng__BillingRule__c both present
     *   - "CPQ"          — SBQQ__Quote__c only
     *   - "Billing"      — blng__BillingRule__c only
     *   - "None"         — probe succeeded but no Revenue Cloud package
     *                      is installed (vanilla DE / Sales Cloud only).
     *                      The dashboard renders this as a neutral badge.
     *   - null           — probe FAILED (auth/network/403). Caller should
     *                      NOT overwrite the existing ProductType__c since
     *                      we genuinely don't know what's on the target.
     *
     * Why marker SObjects instead of the Installed Packages list: the probe we
     * already make asks EntityDefinition whether specific package objects
     * exist. One marker per tier is enough; we don't need the full
     * installed-packages REST call. (Phase 26: the markers below are included
     * in surfacesOfInterest(), so they are always among the names queried.)
     */
    public static String detectInstalledProductType(String namedCredentialName) {
        Set<String> names = getRemoteSObjectNames(namedCredentialName);
        // PROBE FAILED (auth / network / 403 / heap) — MUST stay the first statement.
        // null tells every caller to leave the existing ProductType__c alone.
        if (names == null) return null;

        Boolean hasCpq     = names.contains('SBQQ__Quote__c');
        Boolean hasBilling = names.contains('blng__BillingRule__c');
        Boolean hasArm     = names.contains('ProductSellingModel');

        // 'None' is reachable from EXACTLY this condition and nowhere else. It
        // blocks scanning entirely (ForensicScanService), so it must never be
        // produced by weak or absent evidence of any other kind.
        if (!hasCpq && !hasBilling && !hasArm) return 'None';

        // Phase 28 — ProductSellingModel is a STANDARD object that exists whenever
        // Revenue Cloud is merely PROVISIONED, so its presence alone is not proof
        // the customer runs ARM. A real CPQ customer (SmartSheet) was labelled ARM
        // on that basis and ARM-001 ("active products have no selling model")
        // flagged 1,810 products critical — every active product in an org that
        // has no selling models because it does not use ARM.
        //
        // So when BOTH stacks look present, spend ONE callout to ask whether the
        // ARM surface is actually populated, and demote ARM only on POSITIVE
        // knowledge that it is empty. The asymmetry is deliberate and load-bearing:
        //   0 rows (known)  -> provisioned but unused -> drop ARM
        //   has rows        -> genuinely dual-stack   -> keep ARM
        //   query THREW     -> UNKNOWN                -> keep ARM
        // The throw case is why this calls remoteQuery DIRECTLY rather than
        // query/queryWithFallback: isSchemaVarianceError collapses INVALID_TYPE
        // into an empty list, which is indistinguishable from "zero rows" and
        // would demote a permission-gated ARM org (our Ksolves org is exactly
        // that: ProductSellingModel present but not SOQL-queryable).
        // Only runs in the ambiguous case, so single-stack orgs cost nothing.
        if (hasCpq && hasArm) {
            try {
                if (remoteQuery(namedCredentialName,
                        'SELECT Id FROM ProductSellingModel LIMIT 1').isEmpty()) {
                    hasArm = false;
                }
            } catch (Exception e) {
                // UNKNOWN — perm-gated or transient. Keep ARM; never demote on a throw.
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism] ARM usage probe unknown, keeping ARM: ' + e.getMessage());
            }
        }

        // Phase 27 — return the honest SET, not an arbitrated winner. An org can
        // genuinely run CPQ and ARM together (a CPQ customer mid-migration to
        // Revenue Cloud is the normal case, not an edge case). The old code
        // short-circuited on ARM and silently skipped all 91 CPQ-only detectors
        // on such an org; picking CPQ instead would have skipped 112 ARM ones.
        // Neither is right: gate on the union and let RequiredSurface__c prune.
        //
        // Presence is decided ONLY by the cached EntityDefinition probe, which
        // still lists permission-gated objects. Do NOT "improve" this by probing
        // for data: RLM objects are perm-gated for a scanning integration user,
        // so a real ARM org's 'SELECT Id FROM ProductSellingModel' throws — and
        // queryWithFallback/isSchemaVarianceError collapses that into an EMPTY
        // LIST, indistinguishable from zero rows. That would silently demote a
        // genuine ARM org to CPQ. If a data signal is ever added it must call
        // remoteQuery directly, catch (Exception) — INVALID_TYPE arrives wrapped
        // as OrgQueryException, not CalloutException — and map every throw to
        // UNKNOWN, never to NO_DATA.
        List<String> t = new List<String>();
        if (hasCpq) t.add('CPQ');
        // 'CPQ+Billing' gates the billing suite (BR/INV/FB/GL/LE/RR/TR). Emit it
        // ONLY when the Billing package marker is actually present, never as a
        // default: ORD-FOR-001 has no RequiredSurface__c and flags EVERY
        // activated order on a Billing-less org (see ORD001OrderNoBillingDetector).
        if (hasBilling) t.add('CPQ+Billing');
        if (hasArm) t.add('ARM');
        // 'Billing' is deliberately never emitted: it matched 0 of 229 detectors
        // and was absent from ForensicScan__c's restricted value set, so a
        // Billing-only org threw INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST on the
        // scan insert. A Billing package always implies CPQ tooling in practice.
        return String.join(t, ';');
    }

    public static Boolean remoteSObjectExists(String namedCredentialName, String objName) {
        if (String.isBlank(objName)) return true;
        if (String.isBlank(namedCredentialName)) return true;
        Set<String> names = getRemoteSObjectNames(namedCredentialName);
        if (names == null) return true; // probe failed → fail open
        // Phase 26 — the probe now only asks EntityDefinition about
        // surfacesOfInterest(), so a name we never queried is "unknown", not
        // "absent". Fail open rather than silently gating a detector off.
        Set<String> asked = requestedNameCache.get(namedCredentialName);
        if (asked == null || !asked.contains(objName)) return true;
        return names.contains(objName);
    }

    /**
     * Run a SOQL query. Returns List<Map<String, Object>> regardless
     * of mode. Nested relationship fields are themselves Maps (recursive).
     */
    public static List<Map<String, Object>> query(DetectorContext ctx, String soql) {
        if (ctx == null) throw new OrgQueryException('DetectorContext is required');
        if (String.isBlank(soql)) throw new OrgQueryException('SOQL string is required');

        if (!ctx.isRemote()) {
            // LOCAL — Database.query then normalize SObjects to field maps.
            List<SObject> rows = Database.query(soql);
            return normalizeLocal(rows);
        }

        // REMOTE — HTTP callout via Named Credential.
        return remoteQuery(ctx.namedCredentialName, soql);
    }

    /**
     * Phase 22i — schema-tolerant SOQL. Tries the strict query first.
     * If it fails with a schema-variance error (INVALID_FIELD/INVALID_TYPE
     * / "No such column" / "is not supported"), retries with the loose
     * fallback. If looseSoql is null OR the fallback also fails, returns
     * an empty list silently — the calling detector then naturally
     * emits zero findings rather than blowing up the scan.
     *
     * Use cases:
     *   - Strict query selects a field that only exists in newer RC releases;
     *     loose query omits it. Detector applies the filter client-side.
     *   - Strict query targets an SObject that may not exist in older releases;
     *     loose=null means "give up cleanly".
     *   - Strict query uses one field name (Status); loose uses an alternate
     *     (IsActive) for older releases.
     *
     * Reference: docs/arm-gap-rca.md catalogs the four schema gaps this
     * was built to handle (PSMO.IsActive, RateCardEntry, UnitOfMeasureClass,
     * ProductFulfillmentScenario.Status).
     */
    public static List<Map<String, Object>> queryWithFallback(
            DetectorContext ctx, String strictSoql, String looseSoql) {
        try {
            return query(ctx, strictSoql);
        } catch (Exception e) {
            if (!isSchemaVarianceError(e)) {
                // Real error (auth, network, syntax) — surface it, don't mask.
                throw e;
            }
            System.debug(LoggingLevel.INFO,
                '[OrgPrism Fallback] strict SOQL hit schema variance: ' + e.getMessage());
            if (String.isBlank(looseSoql)) return new List<Map<String, Object>>();
            try {
                return query(ctx, looseSoql);
            } catch (Exception e2) {
                System.debug(LoggingLevel.INFO,
                    '[OrgPrism Skip] loose SOQL also failed: ' + e2.getMessage());
                return new List<Map<String, Object>>();
            }
        }
    }

    @TestVisible
    private static Boolean isSchemaVarianceError(Exception e) {
        String m = e.getMessage();
        if (m == null) return false;
        // Salesforce REST API surfaces both INVALID_FIELD and INVALID_TYPE
        // as HTTP 400 with these codes in the body. Local SOQL exceptions
        // surface the same messages textually. Match either path.
        return m.contains('INVALID_FIELD')
            || m.contains('INVALID_TYPE')
            || m.contains('No such column')
            || m.contains('is not supported')
            || m.contains('understand relationship');
    }

    /**
     * Flatten Database.query results to List<Map>. Recursively
     * unwraps relationship SObjects via getPopulatedFieldsAsMap()
     * so detectors see the same nested-Map shape they get from
     * remote JSON responses.
     */
    @TestVisible
    private static List<Map<String, Object>> normalizeLocal(List<SObject> rows) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        if (rows == null) return out;
        for (SObject r : rows) out.add(sobjectToMap(r));
        return out;
    }

    @TestVisible
    private static Map<String, Object> sobjectToMap(SObject s) {
        if (s == null) return null;
        Map<String, Object> raw = s.getPopulatedFieldsAsMap();
        Map<String, Object> out = new Map<String, Object>();
        for (String key : raw.keySet()) {
            Object v = raw.get(key);
            if (v instanceof SObject) {
                out.put(key, sobjectToMap((SObject) v));
            } else {
                out.put(key, v);
            }
        }
        return out;
    }

    // Phase 26 — public so OrgCapabilityProbeService can run its targeted
    // EntityParticle field probe through the same transport.
    public static List<Map<String, Object>> remoteQuery(String namedCredentialName, String soql) {
        String encoded = EncodingUtil.urlEncode(soql, 'UTF-8');
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + namedCredentialName + '/services/data/' + API_VERSION + '/query/?q=' + encoded);
        req.setMethod('GET');
        req.setHeader('Accept', 'application/json');
        req.setTimeout(CALLOUT_TIMEOUT_MS);

        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (Exception e) {
            throw new OrgQueryException('Remote callout failed: ' + e.getMessage());
        }

        Integer status = res.getStatusCode();
        if (status != 200) {
            String body = (res.getBody() != null) ? res.getBody() : '';
            if (body.length() > 500) body = body.substring(0, 500);
            throw new OrgQueryException('Remote query HTTP ' + status + ': ' + body);
        }

        return parseRecords(res.getBody());
    }

    /**
     * Parse a REST `/query` response body into List<Map>. Strips
     * the `attributes` wrapper Salesforce inserts for each record
     * and any nested relationship records, then returns clean maps.
     * Detectors don't see Salesforce metadata noise.
     */
    @TestVisible
    private static List<Map<String, Object>> parseRecords(String body) {
        Map<String, Object> root;
        try {
            root = (Map<String, Object>) JSON.deserializeUntyped(body);
        } catch (Exception e) {
            throw new OrgQueryException('Could not parse remote response: ' + e.getMessage());
        }

        Object recsObj = root.get('records');
        if (recsObj == null) return new List<Map<String, Object>>();
        List<Object> recs = (List<Object>) recsObj;

        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object o : recs) {
            out.add(stripAttributes((Map<String, Object>) o));
        }
        return out;
    }

    @TestVisible
    private static Map<String, Object> stripAttributes(Map<String, Object> m) {
        if (m == null) return null;
        Map<String, Object> out = new Map<String, Object>();
        for (String key : m.keySet()) {
            if (key == 'attributes') continue;
            Object v = m.get(key);
            if (v instanceof Map<String, Object>) {
                out.put(key, stripAttributes((Map<String, Object>) v));
            } else {
                out.put(key, v);
            }
        }
        return out;
    }
}
