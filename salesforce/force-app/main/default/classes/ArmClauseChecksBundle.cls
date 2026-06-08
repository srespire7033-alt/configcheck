/** Phase 22c-3 — Clauses: ARM-210, ARM-211, ARM-213. Phase 22c-4 adds ARM-212, ARM-214. */
public with sharing class ArmClauseChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubClauses;
    @TestVisible static List<Map<String, Object>> testStubClauseSets;

    public String getDetectorId() { return 'ARM-CLAUSE-BUNDLE'; }
    public String getLabel() { return 'ARM Clause checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> clauses, sets;
        Boolean usingStubs = (testStubClauses != null || testStubClauseSets != null);
        if (usingStubs) {
            clauses = testStubClauses    != null ? testStubClauses    : new List<Map<String, Object>>();
            sets    = testStubClauseSets != null ? testStubClauseSets : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('DocumentClause')) return results;
            try {
                clauses = OrgQueryService.query(ctx,
                    'SELECT Id, Name, Status, Content, DocumentClauseSetId, IsAlternateClause, ' +
                    'ClauseName, ClauseLanguage, CreatedDate, LastModifiedDate, ' +
                    'DocumentClauseSet.Status FROM DocumentClause LIMIT 5000');
                sets = SchemaUtil.hasObject('DocumentClauseSet')
                    ? OrgQueryService.query(ctx, 'SELECT Id, Name, Status FROM DocumentClauseSet LIMIT 2000')
                    : new List<Map<String, Object>>();
            } catch (Exception e) { return results; }
        }
        if (DetectorCatalogController.isActive('ARM-210')) results.addAll(evaluateARM210(clauses));
        if (DetectorCatalogController.isActive('ARM-211')) results.addAll(evaluateARM211(clauses));
        if (DetectorCatalogController.isActive('ARM-212')) results.addAll(evaluateARM212(clauses));
        if (DetectorCatalogController.isActive('ARM-213')) results.addAll(evaluateARM213(clauses));
        if (DetectorCatalogController.isActive('ARM-214')) results.addAll(evaluateARM214(clauses));
        return results;
    }

    @TestVisible
    static List<DetectorResult> evaluateARM212(List<Map<String, Object>> clauses) {
        // Build the set of (setId, clauseName, language) keys where a NON-alternate (main) clause exists.
        // Then flag alternates whose key has no main.
        Set<String> mainKeys = new Set<String>();
        for (Map<String, Object> c : clauses) {
            if (Boolean.valueOf(c.get('IsAlternateClause'))) continue;
            Object setId = c.get('DocumentClauseSetId');
            Object nm = c.get('ClauseName');
            Object lang = c.get('ClauseLanguage');
            if (setId == null || nm == null || lang == null) continue;
            mainKeys.add(String.valueOf(setId) + '|' + String.valueOf(nm) + '|' + String.valueOf(lang));
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : clauses) {
            if (!Boolean.valueOf(c.get('IsAlternateClause'))) continue;
            Object setId = c.get('DocumentClauseSetId');
            Object nm = c.get('ClauseName');
            Object lang = c.get('ClauseLanguage');
            if (setId == null || nm == null || lang == null) continue;
            String k = String.valueOf(setId) + '|' + String.valueOf(nm) + '|' + String.valueOf(lang);
            if (mainKeys.contains(k)) continue;
            bad.add(new SourceRecord('DocumentClause', (Id) c.get('Id'),
                String.valueOf(nm) + ' / ' + String.valueOf(lang) + ' (alternate without main)'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-212'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' alternate clause(s) without a main sibling';
        dr.description = 'Alternate clauses require a matching main clause in the same set + name + language.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM214(List<Map<String, Object>> clauses) {
        // Archived clauses should not be modified post-archival. Threshold: 5min delta
        // between CreatedDate and LastModifiedDate is the noise floor for DML windows.
        Long fiveMinMs = 5L * 60L * 1000L;
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : clauses) {
            if (String.valueOf(c.get('Status')) != 'Archived') continue;
            Datetime cd = parseDt(c.get('CreatedDate'));
            Datetime md = parseDt(c.get('LastModifiedDate'));
            if (cd == null || md == null) continue;
            if (md.getTime() - cd.getTime() <= fiveMinMs) continue;
            bad.add(new SourceRecord('DocumentClause', (Id) c.get('Id'),
                String.valueOf(c.get('Name')) + ' (modified ' + md.format('yyyy-MM-dd') + ')'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-214'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = bad.size() + ' archived clause(s) modified after archival';
        dr.description = 'Archived clauses should not be edited. Investigate the change history.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    static Datetime parseDt(Object o) {
        if (o == null) return null;
        if (o instanceof Datetime) return (Datetime) o;
        String s = String.valueOf(o);
        s = s.replace('T', ' ').replace('Z', '');
        if (s.length() > 19) s = s.substring(0, 19);
        try { return Datetime.valueOfGmt(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateARM210(List<Map<String, Object>> clauses) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : clauses) {
            if (String.valueOf(c.get('Status')) != 'Active') continue;
            Object content = c.get('Content');
            if (content != null && !String.isBlank(String.valueOf(content))) continue;
            bad.add(new SourceRecord('DocumentClause', (Id) c.get('Id'), String.valueOf(c.get('Name'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-210'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' active document clause(s) without content';
        dr.description = 'Clauses must have body content to render in documents.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM211(List<Map<String, Object>> clauses) {
        // Group main clauses (IsAlternateClause = false) by (DocumentClauseSetId, ClauseName, ClauseLanguage)
        Map<String, List<Map<String, Object>>> byKey = new Map<String, List<Map<String, Object>>>();
        for (Map<String, Object> c : clauses) {
            if (Boolean.valueOf(c.get('IsAlternateClause'))) continue;
            Object setId = c.get('DocumentClauseSetId');
            if (setId == null) continue;
            String k = String.valueOf(setId) + '|' + String.valueOf(c.get('ClauseName'))
                + '|' + String.valueOf(c.get('ClauseLanguage'));
            if (!byKey.containsKey(k)) byKey.put(k, new List<Map<String, Object>>());
            byKey.get(k).add(c);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (String k : byKey.keySet()) {
            List<Map<String, Object>> grp = byKey.get(k);
            if (grp.size() <= 1) continue;
            for (Map<String, Object> c : grp) bad.add(new SourceRecord('DocumentClause', (Id) c.get('Id'),
                String.valueOf(c.get('ClauseName')) + ' / ' + String.valueOf(c.get('ClauseLanguage'))));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-211'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' duplicate main clause(s) in clause set/language';
        dr.description = 'Each (clause set, name, language) should have one main clause.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(25, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateARM213(List<Map<String, Object>> clauses) {
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> c : clauses) {
            if (c.get('DocumentClauseSetId') == null) continue;
            Object setRef = c.get('DocumentClauseSet');
            String setStatus = null;
            if (setRef instanceof Map<String, Object>) {
                Object s = ((Map<String, Object>) setRef).get('Status');
                if (s != null) setStatus = String.valueOf(s);
            }
            if (setStatus == 'Active') continue;
            bad.add(new SourceRecord('DocumentClause', (Id) c.get('Id'),
                String.valueOf(c.get('Name')) + ' (set ' + (setStatus == null ? 'missing' : setStatus) + ')'));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'ARM-213'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = bad.size() + ' clause(s) reference missing/inactive set';
        dr.description = 'Document clauses must belong to an active clause set.';
        dr.primaryRecord = bad[0];
        for (Integer i = 1; i < bad.size(); i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}
