/**
 * Phase 25 — Org Capability Probe.
 *
 * Inspects a connected target org's schema at field-level granularity
 * so consultants know up-front which detectors WILL fire vs which are
 * structurally inapplicable (e.g. QL-005 cannot fire on a stock-CPQ
 * org because SBQQ__NetPrice__c has scale=2; CON-FOR-002 cannot fire
 * if SBQQ__MasterContract__c is absent).
 *
 * The probe runs once at testConnection time and the result is cached
 * on ConnectedOrg__c.CapabilityProfileJson__c. UI surfaces grey-out
 * the inapplicable detectors with a hover-tooltip explaining why.
 *
 * The probe is best-effort: any failure during probing leaves the
 * existing CapabilityProfileJson__c untouched so a transient HTTP error
 * doesn't blow away a previously-good profile.
 */
public with sharing class OrgCapabilityProbeService {

    @TestVisible
    private static final String API_VERSION = 'v60.0';
    @TestVisible
    private static final Integer CALLOUT_TIMEOUT_MS = 30000;

    /** Test seam — when non-null, probe() reuses these describe maps
     *  instead of running real callouts. Keyed by SObject API name. */
    @TestVisible static Map<String, Map<String, Object>> testStubDescribes;

    /**
     * Fields-of-interest per SObject. Only these fields land in the
     * persisted profile — everything else is ignored. Keeps the JSON
     * small (well under the 32k LongTextArea cap) and meaningful.
     * Map<SObjectApiName, Set<FieldApiName>>.
     */
    @TestVisible
    static final Map<String, Set<String>> FIELDS_OF_INTEREST = new Map<String, Set<String>>{
        'SBQQ__QuoteLine__c' => new Set<String>{
            // QL-005 (sub-cent precision check)
            'SBQQ__NetPrice__c',
            // QL-006 (amendment source line)
            'SBQQ__Source__c',
            // TF-001 (twin-field conflicts)
            'SBQQ__Uplift__c', 'SBQQ__UpliftAmount__c',
            'SBQQ__AdditionalDiscount__c', 'SBQQ__Discount__c'
        },
        'SBQQ__BlockPrice__c' => new Set<String>{ 'Id', 'SBQQ__Product__c' },
        'sbaa__ApprovalRule__c' => new Set<String>{ 'sbaa__Active__c' },
        'sbaa__Approval__c' => new Set<String>{ 'sbaa__Rule__c' },
        'Contract' => new Set<String>{ 'SBQQ__MasterContract__c' }
    };

    /** SObjects we send a describe callout for (derived from the map above). */
    @TestVisible
    static List<String> probeSObjects() {
        return new List<String>(FIELDS_OF_INTEREST.keySet());
    }

    /**
     * Build a CapabilityProfile for the given connected org and persist
     * it to CapabilityProfileJson__c + CapabilityProbedAt__c. Caller
     * must have FLS on the fields (perm set handles this). Returns the
     * JSON-encoded profile (also stored on the record), or null if the
     * probe could not run (no Named Credential, etc.).
     */
    public static String probe(ConnectedOrg__c org) {
        if (org == null || String.isBlank(org.NamedCredentialName__c)) {
            return null;
        }
        Map<String, Object> profile = buildProfile(org.NamedCredentialName__c);
        if (profile == null) return null;

        String payload = JSON.serialize(profile);
        if (payload.length() > 32000) {
            // 32k LongTextArea cap — paranoia: shouldn't happen with this shape
            payload = payload.substring(0, 32000);
        }
        org.CapabilityProfileJson__c = payload;
        org.CapabilityProbedAt__c = System.now();
        update org;
        return payload;
    }

    /**
     * Build the profile payload without persisting (used by tests and
     * by direct callers who want to inspect before saving).
     */
    public static Map<String, Object> buildProfile(String namedCredentialName) {
        Set<String> sobjectNames = OrgQueryService.getRemoteSObjectNames(namedCredentialName);
        if (sobjectNames == null) return null; // probe failed entirely

        // 1. Package detection
        Map<String, Boolean> packages = new Map<String, Boolean>{
            'cpq'     => sobjectNames.contains('SBQQ__Quote__c'),
            'sbaa'    => sobjectNames.contains('sbaa__ApprovalRule__c'),
            'blng'    => sobjectNames.contains('blng__BillingRule__c'),
            'arm'     => sobjectNames.contains('ProductSellingModel')
        };

        // 2. Field-level probes — only capture fields in our allowlist
        Map<String, Boolean> optionalFields = new Map<String, Boolean>();
        Map<String, Integer> fieldScales = new Map<String, Integer>();
        for (String sobj : FIELDS_OF_INTEREST.keySet()) {
            if (!sobjectNames.contains(sobj)) continue;
            Set<String> wantedFields = FIELDS_OF_INTEREST.get(sobj);
            Map<String, Object> describe = fetchDescribe(namedCredentialName, sobj);
            if (describe == null) continue;
            List<Object> fields = (List<Object>) describe.get('fields');
            if (fields == null) continue;
            for (Object f : fields) {
                if (!(f instanceof Map<String, Object>)) continue;
                Map<String, Object> fm = (Map<String, Object>) f;
                String name = String.valueOf(fm.get('name'));
                if (name == null || !wantedFields.contains(name)) continue;
                String key = sobj + '.' + name;
                optionalFields.put(key, true);
                Object scale = fm.get('scale');
                Integer scaleVal = null;
                if (scale instanceof Integer) scaleVal = (Integer) scale;
                else if (scale instanceof Decimal) scaleVal = ((Decimal) scale).intValue();
                // Record any non-null scale so isApplicable can compare
                // against the threshold (QL-005 expects scale > 2).
                if (scaleVal != null) {
                    fieldScales.put(key, scaleVal);
                }
            }
        }

        return new Map<String, Object>{
            'packages' => packages,
            'optionalFields' => optionalFields,
            'fieldScales' => fieldScales,
            'probedAt' => String.valueOf(System.now())
        };
    }

    /**
     * Fetch the /sobjects/{name}/describe payload for a single SObject
     * on the remote org. Cached per-tx via testStubDescribes seam (tests)
     * or fresh callout (production).
     */
    @TestVisible
    static Map<String, Object> fetchDescribe(String namedCredentialName, String sobj) {
        if (testStubDescribes != null) {
            return testStubDescribes.get(sobj);
        }
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + namedCredentialName + '/services/data/' +
                API_VERSION + '/sobjects/' + sobj + '/describe');
            req.setMethod('GET');
            req.setHeader('Accept', 'application/json');
            req.setTimeout(CALLOUT_TIMEOUT_MS);
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() != 200) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism] Describe ' + sobj + ' HTTP ' + res.getStatusCode());
                return null;
            }
            return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                '[OrgPrism] Describe ' + sobj + ' failed: ' + e.getMessage());
            return null;
        }
    }

    /** DTO returned by isApplicable() — applicability decision + reason. */
    public class Applicability {
        public Boolean applicable;
        public String reason;
        public Applicability(Boolean a, String r) { this.applicable = a; this.reason = r; }
    }

    /**
     * For a single detector ID against a parsed profile, return whether
     * it can fire and why-not if it can't. Keep the rule set narrow —
     * only the detectors with genuinely-known structural constraints.
     * Everything else is "yes, applicable" by default (fail-open).
     */
    public static Applicability isApplicable(Map<String, Object> profile, String detectorId) {
        if (profile == null || String.isBlank(detectorId)) {
            return new Applicability(true, null);
        }
        Map<String, Object> pkgs = mapOf(profile.get('packages'));
        Map<String, Object> fields = mapOf(profile.get('optionalFields'));
        Map<String, Object> scales = mapOf(profile.get('fieldScales'));

        // Package-tier gates: skip detectors whose root surface isn't installed.
        if (detectorId.startsWith('SBQQ-') || detectorId.startsWith('SET-')
                || detectorId.startsWith('QL-') || detectorId.startsWith('PB-')
                || detectorId.startsWith('CP-') || detectorId.startsWith('CT-')
                || detectorId.startsWith('REN-') || detectorId.startsWith('DSC-')
                || detectorId.startsWith('DS-') || detectorId.startsWith('SR-')
                || detectorId.startsWith('SUB-') || detectorId.startsWith('AMD-')) {
            if (pkgs.get('cpq') != true) {
                return new Applicability(false, 'CPQ package not installed (SBQQ__Quote__c missing)');
            }
        }
        if (detectorId.startsWith('AR-')) {
            if (pkgs.get('sbaa') != true) {
                return new Applicability(false, 'Advanced Approvals (sbaa) not installed');
            }
        }
        if (detectorId.startsWith('BR-') || detectorId.startsWith('PBC-')
                || detectorId.startsWith('INV-') || detectorId.startsWith('TR-')
                || detectorId.startsWith('GL-') || detectorId.startsWith('LE-')
                || detectorId.startsWith('RR-') || detectorId.startsWith('FB-')) {
            if (pkgs.get('blng') != true) {
                return new Applicability(false, 'Billing (blng) package not installed');
            }
        }
        if (detectorId.startsWith('ARM-')) {
            if (pkgs.get('arm') != true) {
                return new Applicability(false, 'Revenue Cloud (ARM) not installed');
            }
        }

        // Field-level gates: detectors with known field-existence preconditions.
        if (detectorId == 'QL-005') {
            // QL-005 (sub-cent precision) cannot fire if NetPrice scale<=2
            Object scale = scales.get('SBQQ__QuoteLine__c.SBQQ__NetPrice__c');
            if (scale != null && Integer.valueOf(scale) <= 2) {
                return new Applicability(false,
                    'SBQQ__NetPrice__c scale=' + scale + ' — schema can\'t store sub-cent precision');
            }
        }
        if (detectorId == 'QL-006') {
            if (fields.get('SBQQ__QuoteLine__c.SBQQ__Source__c') != true) {
                return new Applicability(false,
                    'SBQQ__QuoteLine__c.SBQQ__Source__c not present on this CPQ version');
            }
        }
        if (detectorId == 'PB-005') {
            if (fields.get('SBQQ__BlockPrice__c.Id') != true) {
                return new Applicability(false, 'SBQQ__BlockPrice__c not present');
            }
        }
        if (detectorId == 'AR-006') {
            if (fields.get('sbaa__Approval__c.sbaa__Rule__c') != true) {
                return new Applicability(false,
                    'sbaa__Approval__c.sbaa__Rule__c not present — can\'t count rule invocations');
            }
        }
        return new Applicability(true, null);
    }

    /**
     * Bulk applicability map for a connected org. Loads the profile from
     * the persisted JSON, walks all active Detector__mdt records, and
     * returns each detector's applicability decision. Used by the UI to
     * grey-out / annotate the detector catalog list.
     */
    public static Map<String, Applicability> getApplicabilityFor(Id connectedOrgId) {
        Map<String, Applicability> result = new Map<String, Applicability>();
        if (connectedOrgId == null) return result;
        List<ConnectedOrg__c> rows = [
            SELECT Id, CapabilityProfileJson__c FROM ConnectedOrg__c
            WHERE Id = :connectedOrgId LIMIT 1
        ];
        if (rows.isEmpty()) return result;
        Map<String, Object> profile = null;
        String profileText = rows[0].CapabilityProfileJson__c;
        if (String.isNotBlank(profileText)) {
            try {
                profile = (Map<String, Object>) JSON.deserializeUntyped(profileText);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism] CapabilityProfileJson__c parse failed: ' + e.getMessage());
            }
        }
        for (Detector__mdt d : [SELECT DetectorId__c FROM Detector__mdt WHERE IsActive__c = true]) {
            if (String.isBlank(d.DetectorId__c)) continue;
            result.put(d.DetectorId__c, isApplicable(profile, d.DetectorId__c));
        }
        return result;
    }

    @TestVisible
    static Map<String, Object> mapOf(Object o) {
        return (o instanceof Map<String, Object>)
            ? (Map<String, Object>) o : new Map<String, Object>();
    }
}
