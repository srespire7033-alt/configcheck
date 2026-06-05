/**
 * Computes the 0-100 Health Score from severity counts, plus per-category
 * bucket sub-scores (Phase 22e — Vercel parity).
 *
 * HEADLINE FORMULA (Phase 22d — sqrt compression):
 *   raw     = critical × wC + warning × wW + info × wI
 *   capped  = min(raw, Penalty_Cap)
 *   penalty = Curve_Coefficient × sqrt(capped)
 *   score   = clamp(100 - penalty, 0, 100)
 *
 * Why sqrt compression: the previous linear formula saturated to 0 once
 * OrgPrism shipped 200+ detectors. Vercel had the same bug; the sqrt
 * curve preserves the severity ratio while keeping the score informative
 * across a real range: pristine ≈ 95-100, healthy ≈ 70-85, messy ≈ 40-60.
 *
 * PER-CATEGORY SUB-SCORES (Phase 22e — Vercel parity):
 *   For each category:
 *     cat_score = clamp(100 - (crit × catCW) - (warn × catWW) - (info × catIW), 0, 100)
 *   Mirrors Vercel engine.ts:67-113 / billing-engine.ts:46-79 / arm-engine.ts:112-160.
 *   Persisted as JSON to ForensicScan__c.CategoryScoresJson__c.
 *
 * All eight constants live in ScoreFormula__mdt. Admins can tune without
 * code. Falls back to safe defaults if mdt records aren't deployed.
 */
public with sharing class HealthScoreCalculator {

    private static final String DEFAULT_FORMULA = 'Default';
    // Safe fallbacks if Default mdt record isn't deployed yet.
    private static final Decimal FALLBACK_CRIT_WEIGHT = 2.0;
    private static final Decimal FALLBACK_WARN_WEIGHT = 0.5;
    private static final Decimal FALLBACK_INFO_WEIGHT = 0.1;
    private static final Decimal FALLBACK_PENALTY_CAP = 300;
    private static final Decimal FALLBACK_CURVE_COEFF = 4.0;
    private static final Decimal FALLBACK_CAT_CRIT  = 15;
    private static final Decimal FALLBACK_CAT_WARN  = 5;
    private static final Decimal FALLBACK_CAT_INFO  = 1;

    private static Map<String, ScoreFormula__mdt> cache;

    @TestVisible
    private static Map<String, ScoreFormula__mdt> loadFormulas() {
        if (cache != null) return cache;
        cache = new Map<String, ScoreFormula__mdt>();
        for (ScoreFormula__mdt f : [
            SELECT DeveloperName, Critical_Weight__c, Warning_Weight__c, Info_Weight__c,
                   Penalty_Cap__c, Curve_Coefficient__c,
                   Cat_Critical_Weight__c, Cat_Warning_Weight__c, Cat_Info_Weight__c
            FROM ScoreFormula__mdt WITH SECURITY_ENFORCED]) {
            cache.put(f.DeveloperName, f);
        }
        return cache;
    }

    /** Returns [critW, warnW, infoW, penaltyCap, curveCoeff, catCritW, catWarnW, catInfoW]. */
    @TestVisible
    private static Decimal[] paramsFor(String devName) {
        Map<String, ScoreFormula__mdt> all = loadFormulas();
        ScoreFormula__mdt f = all.get(devName);
        if (f == null) f = all.get(DEFAULT_FORMULA);
        if (f == null) {
            return new Decimal[]{ FALLBACK_CRIT_WEIGHT, FALLBACK_WARN_WEIGHT,
                FALLBACK_INFO_WEIGHT, FALLBACK_PENALTY_CAP, FALLBACK_CURVE_COEFF,
                FALLBACK_CAT_CRIT, FALLBACK_CAT_WARN, FALLBACK_CAT_INFO };
        }
        return new Decimal[]{
            f.Critical_Weight__c    != null ? f.Critical_Weight__c    : FALLBACK_CRIT_WEIGHT,
            f.Warning_Weight__c     != null ? f.Warning_Weight__c     : FALLBACK_WARN_WEIGHT,
            f.Info_Weight__c        != null ? f.Info_Weight__c        : FALLBACK_INFO_WEIGHT,
            f.Penalty_Cap__c        != null ? f.Penalty_Cap__c        : FALLBACK_PENALTY_CAP,
            f.Curve_Coefficient__c  != null ? f.Curve_Coefficient__c  : FALLBACK_CURVE_COEFF,
            f.Cat_Critical_Weight__c != null ? f.Cat_Critical_Weight__c : FALLBACK_CAT_CRIT,
            f.Cat_Warning_Weight__c  != null ? f.Cat_Warning_Weight__c  : FALLBACK_CAT_WARN,
            f.Cat_Info_Weight__c     != null ? f.Cat_Info_Weight__c     : FALLBACK_CAT_INFO
        };
    }

    public static Integer compute(Integer critical, Integer warning, Integer info) {
        return computeWithFormula(DEFAULT_FORMULA, critical, warning, info);
    }

    /**
     * Phase 22f — Public helper that applies the per-category bucket weights
     * (Cat_Critical_Weight__c / Cat_Warning_Weight__c / Cat_Info_Weight__c)
     * to a single (crit, warn, info) tuple. Returns a clamped 0-100 score.
     *
     * Used by both computeCategoryScores (pillar scores keyed by Category__c)
     * and CategoryPerformanceController (card-grid scores keyed by
     * CategoryPerformanceCard__mdt) so a single mdt tune drives both.
     */
    public static Integer computeBucketScore(Integer critical, Integer warning, Integer info) {
        Decimal[] p = paramsFor(DEFAULT_FORMULA);
        Decimal c = (critical != null ? critical : 0);
        Decimal wn = (warning != null ? warning : 0);
        Decimal i = (info != null ? info : 0);
        Decimal score = 100 - (c * p[5]) - (wn * p[6]) - (i * p[7]);
        if (score < 0) score = 0;
        if (score > 100) score = 100;
        return score.intValue();
    }

    public static Integer computeWithFormula(String formulaDevName,
                                              Integer critical, Integer warning, Integer info) {
        Decimal[] p = paramsFor(formulaDevName);
        Decimal c = (critical != null ? critical : 0);
        Decimal wn = (warning != null ? warning : 0);
        Decimal i = (info != null ? info : 0);
        Decimal raw = (c * p[0]) + (wn * p[1]) + (i * p[2]);
        if (raw < 0) raw = 0;
        if (raw > p[3]) raw = p[3];
        Decimal penalty = p[4] * Decimal.valueOf(Math.sqrt(raw.doubleValue()));
        Decimal score = 100 - penalty;
        if (score < 0) score = 0;
        if (score > 100) score = 100;
        return score.intValue();
    }

    /**
     * Phase 22e — Per-category bucket sub-scores. Returns category → 0-100.
     * Categories without findings are NOT included (caller treats absent as 100).
     * Detector-to-category mapping comes from Detector__mdt via DetectorCatalogController.
     * Findings whose detector has no mdt record OR no Category__c are tallied under '__uncategorized__'.
     */
    public static Map<String, Integer> computeCategoryScores(Id scanId) {
        Map<String, Integer> out = new Map<String, Integer>();
        if (scanId == null) return out;
        // (Severity, Category) buckets via a single aggregate.
        AggregateResult[] agg = [
            SELECT DetectorId__c det, Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
            WITH SECURITY_ENFORCED GROUP BY DetectorId__c, Severity__c
        ];
        // Aggregate by category.
        Map<String, Integer[]> byCat = new Map<String, Integer[]>(); // cat → [crit, warn, info]
        for (AggregateResult a : agg) {
            String det = (String) a.get('det');
            String sev = (String) a.get('sev');
            Integer n = (Integer) a.get('cnt');
            String cat = categoryOf(det);
            Integer[] bucket = byCat.containsKey(cat) ? byCat.get(cat) : new Integer[]{0, 0, 0};
            if (sev == 'Critical')     bucket[0] += n;
            else if (sev == 'Warning') bucket[1] += n;
            else if (sev == 'Info')    bucket[2] += n;
            byCat.put(cat, bucket);
        }
        for (String cat : byCat.keySet()) {
            Integer[] b = byCat.get(cat);
            out.put(cat, computeBucketScore(b[0], b[1], b[2]));
        }
        return out;
    }

    private static String categoryOf(String detectorId) {
        if (String.isBlank(detectorId)) return '__uncategorized__';
        Detector__mdt m = DetectorCatalogController.getRecord(detectorId);
        if (m == null || String.isBlank(m.Category__c)) return '__uncategorized__';
        return m.Category__c;
    }

    /** Compute + persist headline score AND category JSON on a ForensicScan__c. */
    public static void computeAndStore(Id scanId) {
        if (scanId == null) return;
        AggregateResult[] agg = [
            SELECT Severity__c sev, COUNT(Id) cnt
            FROM ForensicFinding__c
            WHERE ForensicScan__c = :scanId AND HiddenAt__c = null
            WITH SECURITY_ENFORCED GROUP BY Severity__c
        ];
        Integer crit = 0, warn = 0, info = 0;
        for (AggregateResult a : agg) {
            String s = (String) a.get('sev');
            Integer c = (Integer) a.get('cnt');
            if (s == 'Critical') crit = c;
            else if (s == 'Warning') warn = c;
            else if (s == 'Info') info = c;
        }
        Integer score = compute(crit, warn, info);
        Map<String, Integer> catScores = computeCategoryScores(scanId);
        update new ForensicScan__c(
            Id = scanId,
            HealthScore__c = score,
            CategoryScoresJson__c = JSON.serialize(catScores)
        );
    }
}
