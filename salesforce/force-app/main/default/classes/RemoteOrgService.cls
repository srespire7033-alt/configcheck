/**
 * RemoteOrgService — pings a remote Salesforce org via a Named Credential
 * to verify auth + identity. Lets consulting firms confirm the connection
 * before launching a full forensic scan against the remote org.
 *
 * The Named Credential MUST be configured in Setup before a ConnectedOrg__c
 * row references it. We don't accept raw credentials — only the
 * DeveloperName of an existing Named Credential.
 *
 * Public entry points:
 *   testConnection(connectedOrgId) → ConnectionResult (id, ok, orgId, error)
 *   listConnectedOrgs()            → List<ConnectedOrgDto> for the LWC picker
 *
 * Future (Phase 4): rewrite each detector to optionally call out to the
 * remote org via this same Named Credential pattern. v1 only ships the
 * foundation — the auth + identity verification — so consultants can
 * register and validate their client orgs while the detector callout
 * layer is built.
 */
public with sharing class RemoteOrgService {

    public class ConnectionResult {
        @AuraEnabled public Id id;
        @AuraEnabled public Boolean ok;
        @AuraEnabled public String remoteOrgId;
        @AuraEnabled public String remoteOrgName;
        @AuraEnabled public String error;
    }

    public class ConnectedOrgDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String instanceUrl;
        @AuraEnabled public String namedCredential;
        @AuraEnabled public String orgType;
        @AuraEnabled public String productType;
        @AuraEnabled public String status;
        @AuraEnabled public String remoteOrgId;
        @AuraEnabled public Datetime lastConnectedAt;
        @AuraEnabled public String lastError;

        // Enriched scan stats (populated by listConnectedOrgsWithScanStats only).
        @AuraEnabled public Id latestScanId;
        @AuraEnabled public Datetime lastScanAt;
        @AuraEnabled public Integer score;
        @AuraEnabled public Integer scoreDelta;       // current - previous score; null if no previous
        @AuraEnabled public Integer criticalCount;
        @AuraEnabled public Integer totalFindings;
    }

    private static final String API_VERSION = 'v60.0';

    @AuraEnabled(cacheable=true)
    public static List<ConnectedOrgDto> listConnectedOrgs() {
        List<ConnectedOrgDto> out = new List<ConnectedOrgDto>();
        for (ConnectedOrg__c c : [
            SELECT Id, Name, RemoteOrgName__c, InstanceUrl__c, NamedCredentialName__c, OrgType__c, ProductType__c,
                   Status__c, RemoteOrgId__c, LastConnectedAt__c, LastError__c
            FROM ConnectedOrg__c
            WITH SECURITY_ENFORCED
            ORDER BY Name ASC
            LIMIT 200
        ]) {
            ConnectedOrgDto d = new ConnectedOrgDto();
            d.id = c.Id;
            // Phase 22x — prefer the remote Organization.Name (populated by
            // testConnection) over the locally-typed record Name so the card
            // always shows the actual org's name, not the consultant's
            // bookkeeping label like "Ksolves-Sanjeev (ARM)".
            d.name = String.isNotBlank(c.RemoteOrgName__c) ? c.RemoteOrgName__c : c.Name;
            d.instanceUrl = c.InstanceUrl__c;
            d.namedCredential = c.NamedCredentialName__c;
            d.orgType = c.OrgType__c;
            d.productType = c.ProductType__c;
            d.status = c.Status__c;
            d.remoteOrgId = c.RemoteOrgId__c;
            d.lastConnectedAt = c.LastConnectedAt__c;
            d.lastError = c.LastError__c;
            out.add(d);
        }
        return out;
    }

    /**
     * Enriched listing for the card-grid UI. For each Connected Org, joins
     * the most recent ForensicScan__c (Completed status) and aggregates
     * its findings to surface:
     *   - latestScanId, lastScanAt
     *   - score (HealthScore__c)
     *   - scoreDelta vs the previous scan
     *   - criticalCount, totalFindings
     * Performance: 1 query for orgs, 1 query for scans (latest 2 per org,
     * window-aggregated client-side), 1 grouped query for critical counts.
     */
    @AuraEnabled(cacheable=true)
    public static List<ConnectedOrgDto> listConnectedOrgsWithScanStats() {
        List<ConnectedOrgDto> orgs = listConnectedOrgs();
        if (orgs.isEmpty()) return orgs;

        Set<Id> orgIds = new Set<Id>();
        Map<Id, ConnectedOrgDto> byId = new Map<Id, ConnectedOrgDto>();
        for (ConnectedOrgDto d : orgs) {
            orgIds.add(d.id);
            byId.put(d.id, d);
        }

        // Latest scans per org — pull up to 2 to compute delta.
        // We sort by CompletedAt desc and bucket in code.
        Map<Id, List<ForensicScan__c>> scansByOrg = new Map<Id, List<ForensicScan__c>>();
        for (ForensicScan__c s : [
            SELECT Id, ConnectedOrg__c, CompletedAt__c, HealthScore__c, FindingCount__c, Status__c
            FROM ForensicScan__c
            WHERE ConnectedOrg__c IN :orgIds
              AND Status__c = 'Completed'
            ORDER BY ConnectedOrg__c, CompletedAt__c DESC
            LIMIT 1000
        ]) {
            List<ForensicScan__c> bucket = scansByOrg.get(s.ConnectedOrg__c);
            if (bucket == null) {
                bucket = new List<ForensicScan__c>();
                scansByOrg.put(s.ConnectedOrg__c, bucket);
            }
            if (bucket.size() < 2) bucket.add(s);
        }

        // Critical finding counts for the latest scans.
        Set<Id> latestScanIds = new Set<Id>();
        for (List<ForensicScan__c> bucket : scansByOrg.values()) {
            if (!bucket.isEmpty()) latestScanIds.add(bucket[0].Id);
        }
        Map<Id, Integer> criticalsByScan = new Map<Id, Integer>();
        if (!latestScanIds.isEmpty()) {
            for (AggregateResult ar : [
                SELECT ForensicScan__c scanId, COUNT(Id) c
                FROM ForensicFinding__c
                WHERE ForensicScan__c IN :latestScanIds
                  AND Severity__c = 'Critical'
                GROUP BY ForensicScan__c
            ]) {
                criticalsByScan.put((Id) ar.get('scanId'), (Integer) ar.get('c'));
            }
        }

        // Stitch everything together.
        for (Id orgId : orgIds) {
            ConnectedOrgDto d = byId.get(orgId);
            List<ForensicScan__c> bucket = scansByOrg.get(orgId);
            if (bucket == null || bucket.isEmpty()) continue;
            ForensicScan__c latest = bucket[0];
            d.latestScanId = latest.Id;
            d.lastScanAt = latest.CompletedAt__c;
            d.score = (latest.HealthScore__c != null) ? Integer.valueOf(latest.HealthScore__c) : null;
            d.totalFindings = (latest.FindingCount__c != null) ? Integer.valueOf(latest.FindingCount__c) : 0;
            d.criticalCount = criticalsByScan.containsKey(latest.Id) ? criticalsByScan.get(latest.Id) : 0;
            if (bucket.size() > 1 && bucket[1].HealthScore__c != null && latest.HealthScore__c != null) {
                d.scoreDelta = Integer.valueOf(latest.HealthScore__c) - Integer.valueOf(bucket[1].HealthScore__c);
            }
        }
        return orgs;
    }

    /** Pings the remote org via Named Credential and updates the
     *  ConnectedOrg__c record with the result. */
    @AuraEnabled
    public static ConnectionResult testConnection(Id connectedOrgId) {
        ConnectionResult result = new ConnectionResult();
        result.id = connectedOrgId;
        result.ok = false;

        ConnectedOrg__c row;
        try {
            row = [
                SELECT Id, Name, NamedCredentialName__c, InstanceUrl__c,
                       Status__c, RemoteOrgId__c, LastError__c
                FROM ConnectedOrg__c
                WHERE Id = :connectedOrgId
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];
        } catch (Exception e) {
            result.error = 'Connected Org record not found or inaccessible.';
            return result;
        }

        if (String.isBlank(row.NamedCredentialName__c)) {
            row.Status__c = 'Auth Failed';
            row.LastError__c = 'Named Credential field is empty.';
            saveRow(row);
            result.error = row.LastError__c;
            return result;
        }

        // Callout to the remote org's Organization endpoint — small,
        // cheap, returns the org Id + Name so we can confirm identity.
        // URL form: callout:Acme_Production/services/data/v60.0/query/?q=...
        HttpRequest req = new HttpRequest();
        req.setEndpoint(
            'callout:' + row.NamedCredentialName__c
            + '/services/data/' + API_VERSION
            + '/query/?q=' + EncodingUtil.urlEncode('SELECT Id, Name FROM Organization LIMIT 1', 'UTF-8')
        );
        req.setMethod('GET');
        req.setHeader('Accept', 'application/json');
        req.setTimeout(20000);

        Http http = new Http();
        try {
            HttpResponse res = http.send(req);
            Integer code = res.getStatusCode();
            String body = res.getBody();
            if (code == 200) {
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(body);
                List<Object> records = (List<Object>) parsed.get('records');
                if (records == null || records.isEmpty()) {
                    row.Status__c = 'Unreachable';
                    row.LastError__c = 'Auth ok but Organization query returned no rows. ' +
                        'Likely a permissions issue on the integration user.';
                    saveRow(row);
                    result.error = row.LastError__c;
                    return result;
                }
                Map<String, Object> first = (Map<String, Object>) records[0];
                String remoteId = String.valueOf(first.get('Id'));
                String remoteName = String.valueOf(first.get('Name'));
                row.Status__c = 'Connected';
                row.RemoteOrgId__c = remoteId;
                // Phase 22x — persist remote Organization.Name so the card
                // displays it without an extra round-trip on every list call.
                row.RemoteOrgName__c = remoteName;
                row.LastConnectedAt__c = System.now();
                row.LastError__c = null;
                saveRow(row);
                result.ok = true;
                result.remoteOrgId = remoteId;
                result.remoteOrgName = remoteName;
                return result;
            } else if (code == 401 || code == 403) {
                row.Status__c = 'Auth Failed';
                row.LastError__c = 'HTTP ' + code + ' — ' + body.abbreviate(500);
                saveRow(row);
                result.error = row.LastError__c;
                return result;
            } else {
                row.Status__c = 'Unreachable';
                row.LastError__c = 'HTTP ' + code + ' — ' + body.abbreviate(500);
                saveRow(row);
                result.error = row.LastError__c;
                return result;
            }
        } catch (CalloutException ce) {
            row.Status__c = 'Unreachable';
            row.LastError__c = 'Callout exception: ' + ce.getMessage();
            saveRow(row);
            result.error = row.LastError__c;
            return result;
        } catch (Exception e) {
            row.Status__c = 'Unreachable';
            row.LastError__c = 'Unexpected error: ' + e.getMessage();
            saveRow(row);
            result.error = row.LastError__c;
            return result;
        }
    }

    @TestVisible
    private static void saveRow(ConnectedOrg__c row) {
        if (Schema.sObjectType.ConnectedOrg__c.isUpdateable()) {
            update row;
        }
    }
}
