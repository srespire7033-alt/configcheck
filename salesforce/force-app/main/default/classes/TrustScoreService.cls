/**
 * Phase 15c — Trust Scores.
 *
 * Per-detector reliability scoring based on the observed history of
 * findings + their downstream outcomes:
 *
 *   - findingCount     — how many findings this detector has emitted
 *   - recoveredCount   — committed + verified recovery actions
 *   - suppressedCount  — findings marked as False Positive / Not Relevant
 *                       (i.e. consultant tagged them as detector noise)
 *   - regressedCount   — committed actions where CommitVerified__c = false
 *                        after auto-verify (Phase 14a) ran
 *
 * Composite formula (kept simple and explainable):
 *
 *   recoveryRate    = recoveredCount / max(1, recoveredCount + regressedCount)
 *   suppressionRate = suppressedCount / max(1, findingCount)
 *   score = clamp01( 0.7 * recoveryRate + 0.3 * (1 - suppressionRate) )
 *
 * Detectors with < 5 findings get score = null so the UI can show
 * "insufficient data" instead of a noisy near-1.0 from a tiny n.
 *
 * Called once per scan (after AttributionService) so the score
 * always reflects the latest org reality.
 */
public with sharing class TrustScoreService {

    /**
     * Default formula weights — used when TrustScoreFormula__mdt
     * isn't seeded yet. Once seeded, the mdt record overrides these.
     * Kept @TestVisible for the existing test suite.
     */
    @TestVisible private static final Integer DEFAULT_MIN_SAMPLE = 5;
    private static final Decimal DEFAULT_RECOVERY_WEIGHT = 0.7;
    private static final Decimal DEFAULT_SUPPRESSION_WEIGHT = 0.3;

    /** Cache: read mdt once per transaction. */
    private static TrustScoreFormula__mdt cachedFormula;

    @TestVisible
    private static Integer getMinSample() {
        TrustScoreFormula__mdt f = loadFormula();
        if (f != null && f.MinSampleSize__c != null) return Integer.valueOf(f.MinSampleSize__c);
        return DEFAULT_MIN_SAMPLE;
    }

    /** Maintained for tests that reference MIN_SAMPLE directly. Deprecated. */
    @TestVisible
    private static final Integer MIN_SAMPLE = 5;

    private static TrustScoreFormula__mdt loadFormula() {
        if (cachedFormula != null) return cachedFormula;
        try {
            List<TrustScoreFormula__mdt> rows = [
                SELECT RecoveryRateWeight__c, SuppressionRateWeight__c, MinSampleSize__c
                FROM TrustScoreFormula__mdt LIMIT 1
            ];
            if (!rows.isEmpty()) cachedFormula = rows[0];
        } catch (Exception e) {
            // mdt not deployed yet — fall back to defaults
        }
        return cachedFormula;
    }

    /**
     * Recompute trust scores across every detector that has ever
     * emitted a finding. Idempotent — safe to call after every scan.
     * Returns the number of TrustScore__c rows upserted.
     */
    public static Integer recompute() {
        // Pull aggregate counts per detector from ForensicFinding__c.
        Map<String, Integer> totalByDetector = new Map<String, Integer>();
        Map<String, Integer> suppressedByDetector = new Map<String, Integer>();
        for (AggregateResult ag : [
            SELECT DetectorId__c did, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE DetectorId__c != null
            WITH SECURITY_ENFORCED
            GROUP BY DetectorId__c
        ]) {
            totalByDetector.put((String) ag.get('did'), (Integer) ag.get('cnt'));
        }
        for (AggregateResult ag : [
            SELECT DetectorId__c did, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE DetectorId__c != null
              AND Status__c IN ('False Positive', 'Not Relevant', 'Ignored')
            WITH SECURITY_ENFORCED
            GROUP BY DetectorId__c
        ]) {
            suppressedByDetector.put((String) ag.get('did'), (Integer) ag.get('cnt'));
        }

        // Pull recovery outcomes per detector.
        Map<String, Integer> recoveredByDetector = new Map<String, Integer>();
        Map<String, Integer> regressedByDetector = new Map<String, Integer>();
        for (AggregateResult ag : [
            SELECT ForensicFinding__r.DetectorId__c did, COUNT(Id) cnt
            FROM RecoveryAction__c
            WHERE ApprovalStatus__c = 'Committed'
              AND CommitVerified__c = true
              AND ForensicFinding__r.DetectorId__c != null
            WITH SECURITY_ENFORCED
            GROUP BY ForensicFinding__r.DetectorId__c
        ]) {
            recoveredByDetector.put((String) ag.get('did'), (Integer) ag.get('cnt'));
        }
        // Note: VerificationMessage__c is a LongTextArea and can't be
        // filtered. CommitVerified__c=false + CommittedAt__c!=null is
        // the correct discriminator — only actions that actually went
        // through commit + verify can be 'regressed'.
        for (AggregateResult ag : [
            SELECT ForensicFinding__r.DetectorId__c did, COUNT(Id) cnt
            FROM RecoveryAction__c
            WHERE ApprovalStatus__c = 'Committed'
              AND CommitVerified__c = false
              AND CommittedAt__c != null
              AND ForensicFinding__r.DetectorId__c != null
            WITH SECURITY_ENFORCED
            GROUP BY ForensicFinding__r.DetectorId__c
        ]) {
            regressedByDetector.put((String) ag.get('did'), (Integer) ag.get('cnt'));
        }

        // Build the upsert set keyed on DetectorId__c (external Id).
        Datetime now1 = System.now();
        List<TrustScore__c> toUpsert = new List<TrustScore__c>();
        for (String did : totalByDetector.keySet()) {
            Integer findings = totalByDetector.get(did);
            Integer suppressed = nz(suppressedByDetector.get(did));
            Integer recovered = nz(recoveredByDetector.get(did));
            Integer regressed = nz(regressedByDetector.get(did));

            TrustScore__c row = new TrustScore__c(
                DetectorId__c = did,
                Name = did,
                FindingCount__c = findings,
                SuppressedCount__c = suppressed,
                RecoveredCount__c = recovered,
                RegressedCount__c = regressed,
                Score__c = computeScore(findings, suppressed, recovered, regressed),
                LastComputedAt__c = now1
            );
            toUpsert.add(row);
        }
        if (toUpsert.isEmpty()) return 0;

        // Upsert on the external Id so a row already in the org gets
        // updated in place; new detectors get inserted.
        Schema.SObjectField extIdField = TrustScore__c.Fields.DetectorId__c;
        Database.upsert(toUpsert, extIdField, false);
        return toUpsert.size();
    }

    /**
     * Public API for the LWC: returns all current TrustScore__c rows
     * sorted descending by score. Insufficient-data rows (null score)
     * sort to the bottom so the dashboard leads with the trustworthy
     * detectors.
     */
    @AuraEnabled(cacheable=true)
    public static List<TrustScore__c> getAllScores() {
        return [
            SELECT Id, DetectorId__c, Name, Score__c,
                   FindingCount__c, SuppressedCount__c,
                   RecoveredCount__c, RegressedCount__c,
                   LastComputedAt__c
            FROM TrustScore__c
            WITH SECURITY_ENFORCED
            ORDER BY Score__c DESC NULLS LAST, DetectorId__c ASC
        ];
    }

    /**
     * Pure compute — exposed so tests can validate the formula without
     * needing to insert rows.
     */
    @TestVisible
    static Decimal computeScore(Integer findings, Integer suppressed, Integer recovered, Integer regressed) {
        Integer minSample = getMinSample();
        if (findings == null || findings < minSample) return null;
        TrustScoreFormula__mdt f = loadFormula();
        Decimal wR = (f != null && f.RecoveryRateWeight__c != null)
            ? f.RecoveryRateWeight__c : DEFAULT_RECOVERY_WEIGHT;
        Decimal wS = (f != null && f.SuppressionRateWeight__c != null)
            ? f.SuppressionRateWeight__c : DEFAULT_SUPPRESSION_WEIGHT;

        Decimal verifiedTotal = Math.max(1, recovered + regressed);
        Decimal recoveryRate = ((Decimal) recovered) / verifiedTotal;
        Decimal suppressionRate = ((Decimal) suppressed) / Math.max(1, findings);
        Decimal raw = wR * recoveryRate + wS * (1 - suppressionRate);
        if (raw < 0) raw = 0;
        if (raw > 1) raw = 1;
        return raw.setScale(2, System.RoundingMode.HALF_UP);
    }

    private static Integer nz(Integer v) { return v == null ? 0 : v; }
}
