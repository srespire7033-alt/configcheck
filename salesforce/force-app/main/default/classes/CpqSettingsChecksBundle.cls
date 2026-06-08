/**
 * Phase 22a-5 — 4 checks on SBQQ__GeneralSettings__c (CPQ org settings).
 *
 *   SET-001 — CPQ triggers disabled (critical)
 *   SET-002 — QCP exists and is active (info, advisory)
 *   SET-003 — Renewal Model not configured (warning)
 *   SET-004 — Subscription Term Unit not set (info)
 *
 * CPQ general settings is a List Custom Setting; we use plain SOQL with
 * LIMIT 1 to match the TS implementation. NULL/missing settings → skip.
 */
public with sharing class CpqSettingsChecksBundle implements IDetector {

    @TestVisible static Map<String, Object> testStubSettings;
    @TestVisible static Boolean testStubHasQcp;

    public String getDetectorId() { return 'SET-BUNDLE'; }
    public String getLabel() { return 'CPQ Settings health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ', 'CPQ+Billing' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();

        Map<String, Object> settings;
        Boolean hasQcp;

        if (testStubSettings != null || testStubHasQcp != null) {
            settings = testStubSettings;
            hasQcp = (testStubHasQcp != null) ? testStubHasQcp : false;
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('SBQQ__GeneralSettings__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] SET-BUNDLE: SBQQ__GeneralSettings__c not present.');
                return results;
            }
            settings = querySettings(ctx);
            hasQcp = queryHasQcp(ctx);
        }

        if (settings == null) return results;

        Boolean runSET001 = DetectorCatalogController.isActive('SET-001');
        Boolean runSET002 = DetectorCatalogController.isActive('SET-002');
        Boolean runSET003 = DetectorCatalogController.isActive('SET-003');
        Boolean runSET004 = DetectorCatalogController.isActive('SET-004');

        if (runSET001) results.addAll(evaluateSET001(settings));
        if (runSET002 && hasQcp) results.addAll(evaluateSET002());
        if (runSET003) results.addAll(evaluateSET003(settings));
        if (runSET004) results.addAll(evaluateSET004(settings));
        return results;
    }

    @TestVisible
    static Map<String, Object> querySettings(DetectorContext ctx) {
        Boolean hasTrigger = SchemaUtil.hasField('SBQQ__GeneralSettings__c', 'SBQQ__TriggerDisabled__c');
        Boolean hasRenewal = SchemaUtil.hasField('SBQQ__GeneralSettings__c', 'SBQQ__RenewalModel__c');
        Boolean hasTermUnit = SchemaUtil.hasField('SBQQ__GeneralSettings__c', 'SBQQ__SubscriptionTermUnit__c');
        String soql = 'SELECT Id'
            + (hasTrigger ? ', SBQQ__TriggerDisabled__c' : '')
            + (hasRenewal ? ', SBQQ__RenewalModel__c' : '')
            + (hasTermUnit ? ', SBQQ__SubscriptionTermUnit__c' : '')
            + ' FROM SBQQ__GeneralSettings__c LIMIT 1';
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx, soql);
            return rows.isEmpty() ? null : rows[0];
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '[OrgPrism Skip] SET-BUNDLE: ' + e.getMessage());
            return null;
        }
    }

    @TestVisible
    static Boolean queryHasQcp(DetectorContext ctx) {
        try {
            List<Map<String, Object>> qcps = OrgQueryService.query(ctx,
                'SELECT Id FROM SBQQ__CustomScript__c WHERE SBQQ__Type__c = \'Quote Calculator Plugin\' LIMIT 1');
            return !qcps.isEmpty();
        } catch (Exception e) { return false; }
    }

    @TestVisible
    static List<DetectorResult> evaluateSET001(Map<String, Object> settings) {
        Object td = settings.get('SBQQ__TriggerDisabled__c');
        if (td == null || Boolean.valueOf(td) == false) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SET-001'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Critical'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = 'CPQ Triggers are DISABLED';
        dr.description = 'SBQQ__TriggerDisabled__c is set to TRUE. ALL CPQ managed package triggers are disabled. Quotes will not calculate, subscriptions will not be created, renewals will fail.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSET002() {
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SET-002'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = 'Custom Quote Calculator Plugin is active';
        dr.description = 'A QCP is configured. This JavaScript runs during quote calculation and can override standard pricing logic. Any pricing bug must be investigated against the QCP code first.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSET003(Map<String, Object> settings) {
        Object rm = settings.get('SBQQ__RenewalModel__c');
        if (rm != null && !String.isBlank(String.valueOf(rm))) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SET-003'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning'); dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'CPQ Renewal Model is not configured';
        dr.description = 'SBQQ__RenewalModel__c is not set. Controls how renewal quotes are generated. Without it, CPQ uses an unspecified default that may not match your renewal flow.';
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateSET004(Map<String, Object> settings) {
        Object tu = settings.get('SBQQ__SubscriptionTermUnit__c');
        if (tu != null && !String.isBlank(String.valueOf(tu))) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'SET-004'; dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Info'); dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = 'Subscription Term Unit is not explicitly set';
        dr.description = 'SBQQ__SubscriptionTermUnit__c is not configured. CPQ defaults to "Month"; should be explicitly set to match your billing model.';
        return new List<DetectorResult>{ dr };
    }
}
