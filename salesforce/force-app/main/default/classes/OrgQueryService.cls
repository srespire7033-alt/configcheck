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
    private static final Integer CALLOUT_TIMEOUT_MS = 120000;

    public class OrgQueryException extends Exception {}

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

    @TestVisible
    private static List<Map<String, Object>> remoteQuery(String namedCredentialName, String soql) {
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
