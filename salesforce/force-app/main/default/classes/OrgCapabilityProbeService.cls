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

    /** SObjects we probe fields on (derived from the map above).
     *  Phase 26 — public so OrgQueryService.surfacesOfInterest() can fold
     *  these into its single EntityDefinition existence query. */
    public static List<String> probeSObjects() {
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

        // 3. Phase 28 — data breadth. An EMPTY org and a HEALTHY org both scan
        //    to zero findings and a green health score, which reads as a clean
        //    bill of health when it actually means "there was nothing to audit".
        //    This records whether the core transactional objects hold ANY rows
        //    so the UI can say so. ANNOTATION ONLY — it must never gate a
        //    detector, a scan, or the score.
        Map<String, Object> dataBreadth = probeDataBreadth(namedCredentialName, packages);

        return new Map<String, Object>{
            'packages' => packages,
            'optionalFields' => optionalFields,
            'fieldScales' => fieldScales,
            'dataBreadth' => dataBreadth,
            'hasAuditableData' => summarizeAuditableData(dataBreadth),
            'probedAt' => String.valueOf(System.now())
        };
    }

    /**
     * Phase 28 — per-object "does this hold any rows" probe, scoped to the
     * stacks the org actually runs so we never spend a callout on an absent
     * package. One cheap `SELECT Id ... LIMIT 1` each, at CONNECT time — never
     * inside the scan, whose cumulative callout budget is already tight.
     *
     * TRI-STATE, and the distinction matters: true = has rows, false = queried
     * successfully and found none, ABSENT = unknown. A thrown query (the object
     * is permission-gated for the integration user, which is the normal state
     * for RLM objects) MUST land in "unknown" and never in "false" — otherwise
     * a locked-down org gets branded empty. Same lesson as detectInstalledProductType.
     */
    @TestVisible
    static Map<String, Object> probeDataBreadth(String namedCredentialName, Map<String, Boolean> packages) {
        List<String> targets = new List<String>();
        if (packages.get('cpq') == true) {
            targets.add('SBQQ__Quote__c');
            targets.add('SBQQ__Subscription__c');
        }
        if (packages.get('arm') == true) {
            targets.add('ProductSellingModel');
            targets.add('Asset');
        }
        if (packages.get('blng') == true) {
            targets.add('blng__Invoice__c');
        }
        targets.add('Order');   // meaningful for every stack

        Map<String, Object> out = new Map<String, Object>();
        for (String obj : targets) {
            if (out.containsKey(obj)) continue;
            try {
                List<Map<String, Object>> rows = OrgQueryService.remoteQuery(
                    namedCredentialName, 'SELECT Id FROM ' + obj + ' LIMIT 1');
                out.put(obj, !rows.isEmpty());
            } catch (Exception e) {
                // Unknown — object missing, perm-gated, or transient failure.
                // Deliberately NOT recorded as false.
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism] Data-breadth probe ' + obj + ' unknown: ' + e.getMessage());
            }
        }
        return out;
    }

    /**
     * Phase 28 — true if ANY probed object holds rows; false only when at least
     * one probe SUCCEEDED and every successful probe came back empty; null when
     * we learned nothing at all (so the UI stays quiet rather than crying wolf).
     */
    @TestVisible
    static Boolean summarizeAuditableData(Map<String, Object> dataBreadth) {
        if (dataBreadth == null || dataBreadth.isEmpty()) return null;
        Boolean anyKnown = false;
        for (Object v : dataBreadth.values()) {
            if (!(v instanceof Boolean)) continue;
            anyKnown = true;
            if ((Boolean) v) return true;
        }
        return anyKnown ? false : null;
    }

    /**
     * Fetch the allowlisted fields (name + scale) for a single SObject on the
     * remote org, shaped as {'fields' => [{'name','scale'}]} — the same shape
     * the old /sobjects/{name}/describe payload was reduced to. Served from the
     * testStubDescribes seam in tests, or a targeted EntityParticle query in
     * production (Phase 26 — see the note in the body).
     */
    @TestVisible
    static Map<String, Object> fetchDescribe(String namedCredentialName, String sobj) {
        if (testStubDescribes != null) {
            return testStubDescribes.get(sobj);
        }
        // Phase 26 (heap fix) — this was GET /sobjects/{name}/describe: the FULL
        // describe payload (measured 310 KB for SBQQ__QuoteLine__c on a stock dev
        // org, far more on a customised one) downloaded and deserialized whole
        // just to read ~6 field names and their scale. Replaced with a targeted
        // EntityParticle query. EntityParticle.Scale was verified byte-identical
        // to describe's `scale` on the exact fields QL-005 gates, and the
        // EntityParticle field set matched describe 148/148 on QuoteLine.
        // The return shape is deliberately unchanged ({'fields' => [{'name','scale'}]})
        // so buildProfile's extraction loop and the testStubDescribes tests are untouched.
        // Kept per-object (not one flattened query) so buildProfile's
        // wantedFields.contains(name) filter stays correct — a combined query
        // returns Id for every entity and would pollute optionalFields.
        Set<String> wanted = FIELDS_OF_INTEREST.get(sobj);
        if (wanted == null || wanted.isEmpty()) return null;
        try {
            List<String> quoted = new List<String>();
            for (String f : wanted) quoted.add('\'' + String.escapeSingleQuotes(f) + '\'');
            String soql =
                'SELECT QualifiedApiName, Scale FROM EntityParticle'
              + ' WHERE EntityDefinition.QualifiedApiName = \'' + String.escapeSingleQuotes(sobj) + '\''
              + ' AND QualifiedApiName IN (' + String.join(quoted, ',') + ')';
            List<Object> fields = new List<Object>();
            for (Map<String, Object> r : OrgQueryService.remoteQuery(namedCredentialName, soql)) {
                fields.add(new Map<String, Object>{
                    'name'  => r.get('QualifiedApiName'),
                    'scale' => r.get('Scale')
                });
            }
            return new Map<String, Object>{ 'fields' => fields };
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                '[OrgPrism] Field probe ' + sobj + ' failed: ' + e.getMessage());
            return null;
        }
    }

    /** DTO returned by isApplicable() — applicability decision + reason.
     *  Fields are @AuraEnabled so LWCs can read the map values directly. */
    public class Applicability {
        @AuraEnabled public Boolean applicable;
        @AuraEnabled public String reason;
        public Applicability(Boolean a, String r) { this.applicable = a; this.reason = r; }
    }

    /** Phase 25-B — LWC-shaped summary for the pre-scan banner + catalog grey-out. */
    public class ApplicabilitySummary {
        @AuraEnabled public Integer total;
        @AuraEnabled public Integer applicable;
        @AuraEnabled public Integer skipped;
        @AuraEnabled public Boolean profiled;          // false when org has never been probed
        @AuraEnabled public Datetime probedAt;
        @AuraEnabled public Map<String, Applicability> decisions;
        // Phase 28 — data breadth. null = unknown (UI stays quiet), false = the
        // org holds no auditable transaction data, true = there is something to
        // audit. Annotation only; never gates anything.
        @AuraEnabled public Boolean hasAuditableData;
        @AuraEnabled public String dataNote;
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

    /**
     * Phase 25-B — LWC entry-point. Same payload as
     * getApplicabilityFor() but wrapped in an LWC-friendly DTO with
     * pre-computed counts. cacheable=true because the decisions are
     * pure functions of (profile, active detectors) and both are
     * stable within a session.
     */
    @AuraEnabled(cacheable=true)
    public static ApplicabilitySummary getApplicabilitySummary(Id connectedOrgId) {
        ApplicabilitySummary dto = new ApplicabilitySummary();
        dto.total = 0;
        dto.applicable = 0;
        dto.skipped = 0;
        dto.profiled = false;
        dto.decisions = new Map<String, Applicability>();
        if (connectedOrgId == null) return dto;

        List<ConnectedOrg__c> rows = [
            SELECT Id, CapabilityProfileJson__c, CapabilityProbedAt__c
            FROM ConnectedOrg__c WHERE Id = :connectedOrgId LIMIT 1
        ];
        if (rows.isEmpty()) return dto;
        dto.profiled = String.isNotBlank(rows[0].CapabilityProfileJson__c);
        dto.probedAt = rows[0].CapabilityProbedAt__c;

        dto.decisions = getApplicabilityFor(connectedOrgId);
        for (Applicability a : dto.decisions.values()) {
            dto.total++;
            if (a.applicable) dto.applicable++;
            else dto.skipped++;
        }

        // Phase 28 — surface data breadth so an EMPTY org is distinguishable
        // from a HEALTHY one. Both scan to zero findings and a green score;
        // only this tells them apart.
        if (String.isNotBlank(rows[0].CapabilityProfileJson__c)) {
            try {
                Map<String, Object> profile =
                    (Map<String, Object>) JSON.deserializeUntyped(rows[0].CapabilityProfileJson__c);
                Object had = profile.get('hasAuditableData');
                if (had instanceof Boolean) {
                    dto.hasAuditableData = (Boolean) had;
                    if (!(Boolean) had) {
                        List<String> empties = new List<String>();
                        Object db = profile.get('dataBreadth');
                        if (db instanceof Map<String, Object>) {
                            for (String k : ((Map<String, Object>) db).keySet()) {
                                Object v = ((Map<String, Object>) db).get(k);
                                if (v instanceof Boolean && !(Boolean) v) empties.add(k);
                            }
                        }
                        empties.sort();
                        dto.dataNote = 'No transaction data found'
                            + (empties.isEmpty() ? '' : ' (' + String.join(empties, ', ') + ' all empty)')
                            + ' — a scan will have nothing to audit, so a clean result here does not mean a healthy org.';
                    }
                }
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN,
                    '[OrgPrism] dataBreadth read failed: ' + e.getMessage());
            }
        }
        return dto;
    }

    /**
     * Phase 25-B — Imperative LWC action: probe (or re-probe) a target
     * org now. Returns the count summary so the LWC can refresh its UI
     * after the probe completes. Not cacheable — this is a write.
     */
    @AuraEnabled
    public static ApplicabilitySummary probeNow(Id connectedOrgId) {
        if (connectedOrgId == null) {
            throw new AuraHandledException('connectedOrgId is required');
        }
        List<ConnectedOrg__c> rows = [
            SELECT Id, NamedCredentialName__c FROM ConnectedOrg__c
            WHERE Id = :connectedOrgId LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new AuraHandledException('Connected Org not found: ' + connectedOrgId);
        }
        try {
            probe(rows[0]);
        } catch (Exception e) {
            throw new AuraHandledException('Probe failed: ' + e.getMessage());
        }
        // Re-query to pick up the freshly persisted JSON.
        return getApplicabilitySummary(connectedOrgId);
    }

    @TestVisible
    static Map<String, Object> mapOf(Object o) {
        return (o instanceof Map<String, Object>)
            ? (Map<String, Object>) o : new Map<String, Object>();
    }
}
