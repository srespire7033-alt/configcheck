/**
 * Phase 24q — LWC controller for the per-org Detector Override admin UI.
 *
 * One method to list every detector with its catalog default + current
 * override for the org. One method to save changes. Records are keyed
 * by (ConnectedOrg__c, DetectorId__c) — upsert pattern.
 */
public with sharing class DetectorOverrideController {

    public class OverrideRow {
        @AuraEnabled public String detectorId;
        @AuraEnabled public String label;
        @AuraEnabled public String category;
        @AuraEnabled public String defaultSeverity;
        @AuraEnabled public String overrideSeverity; // null means no override
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public String notes;
        @AuraEnabled public Id overrideRecordId;     // null until first save
    }

    /**
     * Return one row per shipped detector with its catalog default and
     * any matching override for this org. Sorted by detector id.
     */
    @AuraEnabled(cacheable=true)
    public static List<OverrideRow> getOverridesForOrg(Id connectedOrgId) {
        if (connectedOrgId == null) {
            throw new AuraHandledException('connectedOrgId is required');
        }

        // Catalog: Detector__mdt (covers all 221 detectors including
        // the 64 migrated ones whose CustomDetector twin shares the id).
        Map<String, Detector__mdt> catalog = new Map<String, Detector__mdt>();
        for (Detector__mdt d : [
            SELECT DetectorId__c, Label__c, Category__c, Severity__c, IsActive__c
            FROM Detector__mdt
            WHERE DetectorId__c != null AND IsActive__c = true
            WITH SECURITY_ENFORCED
        ]) {
            catalog.put(d.DetectorId__c, d);
        }

        // Existing overrides for this org.
        Map<String, DetectorOverride__c> overrides = new Map<String, DetectorOverride__c>();
        try {
            for (DetectorOverride__c o : [
                SELECT Id, DetectorId__c, SeverityOverride__c, IsActive__c, Notes__c
                FROM DetectorOverride__c
                WHERE ConnectedOrg__c = :connectedOrgId
                WITH SECURITY_ENFORCED
            ]) {
                overrides.put(o.DetectorId__c, o);
            }
        } catch (Exception e) {
            // SObject not yet deployed in this snapshot — fall through.
        }

        List<OverrideRow> rows = new List<OverrideRow>();
        for (String detId : catalog.keySet()) {
            Detector__mdt d = catalog.get(detId);
            OverrideRow row = new OverrideRow();
            row.detectorId = detId;
            row.label = d.Label__c;
            row.category = d.Category__c;
            row.defaultSeverity = d.Severity__c;
            DetectorOverride__c ov = overrides.get(detId);
            if (ov != null) {
                row.overrideSeverity = ov.SeverityOverride__c;
                row.isActive = ov.IsActive__c;
                row.notes = ov.Notes__c;
                row.overrideRecordId = ov.Id;
            }
            rows.add(row);
        }
        rows.sort(new RowComparator());
        return rows;
    }

    public class RowComparator implements Comparator<OverrideRow> {
        public Integer compare(OverrideRow a, OverrideRow b) {
            String ac = a.category == null ? 'zzz' : a.category;
            String bc = b.category == null ? 'zzz' : b.category;
            if (ac < bc) return -1;
            if (ac > bc) return 1;
            String ad = a.detectorId == null ? '' : a.detectorId;
            String bd = b.detectorId == null ? '' : b.detectorId;
            if (ad < bd) return -1;
            if (ad > bd) return 1;
            return 0;
        }
    }

    /**
     * Upsert/delete overrides for one org in a single tx.
     *
     * For each row in `rows`:
     *   - overrideSeverity null + overrideRecordId set → delete row
     *   - overrideSeverity non-null → upsert (insert if no recordId,
     *     update if recordId)
     *   - overrideSeverity null + no recordId → no-op
     */
    @AuraEnabled
    public static void saveOverrides(Id connectedOrgId, List<OverrideRow> rows) {
        if (connectedOrgId == null) {
            throw new AuraHandledException('connectedOrgId is required');
        }
        if (rows == null || rows.isEmpty()) return;

        List<DetectorOverride__c> toUpsert = new List<DetectorOverride__c>();
        List<DetectorOverride__c> toDelete = new List<DetectorOverride__c>();
        for (OverrideRow r : rows) {
            if (String.isBlank(r.detectorId)) continue;
            Boolean hasOverride = String.isNotBlank(r.overrideSeverity);
            if (!hasOverride && r.overrideRecordId != null) {
                toDelete.add(new DetectorOverride__c(Id = r.overrideRecordId));
                continue;
            }
            if (!hasOverride) continue;
            DetectorOverride__c o = new DetectorOverride__c(
                Id = r.overrideRecordId,
                ConnectedOrg__c = connectedOrgId,
                DetectorId__c = r.detectorId,
                SeverityOverride__c = r.overrideSeverity,
                IsActive__c = r.isActive == null ? true : r.isActive,
                Notes__c = r.notes
            );
            toUpsert.add(o);
        }
        if (!toUpsert.isEmpty()) upsert toUpsert;
        if (!toDelete.isEmpty()) delete toDelete;
        // No cache bust needed: DetectorOverrideService caches per-tx,
        // and the next scan runs in its own transaction.
    }
}
