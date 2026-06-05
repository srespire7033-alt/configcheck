/**
 * Phase 12 — Finding renderer.
 *
 * Takes the detector's draft Title__c / Description__c and rewrites
 * them into polished, business-readable prose using the detector ID
 * + parsed Metadata__c. Called from ForensicScanService.toFindingRecord
 * just before insert, so detectors stay simple and all prose-polish
 * lives in one place.
 *
 * Design notes:
 *   - Deterministic templates only. No callouts, no LLM. Safe for
 *     AppExchange security review; runs inline in the scan transaction.
 *   - If a detector's draft is already business-readable (most are),
 *     polish() returns it unchanged. Only the engineer-y ones get
 *     overwritten.
 *   - All money formatted as `$12,500` — leading $, comma-grouped,
 *     no trailing decimals on whole numbers; 2 dp on partial amounts.
 *   - Helpers are private static — this class never holds state.
 */
public class FindingRenderer {

    /**
     * Polishes the title + description on the ForensicFinding in
     * place. Caller is responsible for passing the deserialized
     * metadata (use `parseMeta` if you only have the raw JSON).
     */
    public static void polish(ForensicFinding__c f, Map<String, Object> meta) {
        if (f == null) return;
        if (meta == null) meta = new Map<String, Object>();
        String did = f.DetectorId__c;
        if (did == null) return;

        if (did == 'QL-FOR-001')  renderBundleZero(f, meta);
        else if (did == 'DSC-FOR-001') renderPromoRolloff(f, meta);
        else if (did == 'REN-001') renderRenewalUplift(f, meta);
        else if (did == 'REN-002') renderRenewalBelowList(f, meta);
        else if (did == 'ORD-FOR-001') renderOrderNoBilling(f, meta);
        else if (did == 'ORD-FOR-002') renderQOVariance(f, meta);
        else if (did == 'ORD-FOR-003') renderAmendmentVariance(f, meta);
        // Everything else keeps its detector-emitted text — those reads
        // already cleanly in the UI.
    }

    public static Map<String, Object> parseMeta(String raw) {
        if (String.isBlank(raw)) return new Map<String, Object>();
        try {
            Object o = JSON.deserializeUntyped(raw);
            if (o instanceof Map<String, Object>) return (Map<String, Object>) o;
        } catch (Exception e) { /* swallow — return empty */ }
        return new Map<String, Object>();
    }

    // ─── Detector-specific templates ───────────────────────────────────

    private static void renderBundleZero(ForensicFinding__c f, Map<String, Object> m) {
        // QL-FOR-001 metadata is sparse — pull from the title for the
        // product name, no further templating needed beyond the gap line.
        Decimal gap = scale2(f.GapUsd__c);
        f.Description__c = 'Required bundle option is being given away at $0, ' +
            'but the underlying product carries a positive list price. ' +
            'Expected revenue: ' + money(gap) + '. ' +
            'Either restore the line price or confirm the option is intended to be free.';
    }

    private static void renderPromoRolloff(ForensicFinding__c f, Map<String, Object> m) {
        String schedule = (String) m.get('scheduleName');
        Object endRaw = m.get('scheduleEndDate');
        String endStr = (endRaw == null) ? null : String.valueOf(endRaw);
        Decimal gap = scale2(f.GapUsd__c);
        String whenPhrase = (endStr != null) ? ' (ended ' + endStr + ')' : '';
        f.Description__c = 'Promotional discount schedule ' +
            (schedule != null ? '"' + schedule + '"' : '') + whenPhrase +
            ' is past its end date but is still being applied to this Quote Line. ' +
            'Over-discounting cost: ' + money(gap) + '. ' +
            'Inactivate the schedule or reprice the affected lines.';
    }

    private static void renderRenewalUplift(ForensicFinding__c f, Map<String, Object> m) {
        Decimal uplift = toDec(m.get('upliftPct'));
        Decimal original = toDec(m.get('originalPrice'));
        Decimal entitled = toDec(m.get('entitledPrice'));
        Decimal gap = scale2(f.GapUsd__c);
        String upliftPhrase = (uplift != null)
            ? 'Expected uplift of ' + pct(uplift) + ' was not applied'
            : 'The configured renewal uplift was not applied';
        f.Description__c = upliftPhrase + ' on this renewal line. ' +
            'Prior period: ' + money(original) + '. Entitled (with uplift): ' + money(entitled) +
            '. Recoverable gap: ' + money(gap) + '. ' +
            'Re-price the renewal or check for a Price Rule overwriting NetPrice.';
    }

    private static void renderRenewalBelowList(ForensicFinding__c f, Map<String, Object> m) {
        Decimal netPrice = toDec(m.get('renewalNetPrice'));
        Decimal listPrice = toDec(m.get('currentListPrice'));
        Decimal pctBelow = toDec(m.get('percentBelowList'));
        Decimal gap = scale2(f.GapUsd__c);
        String pctPhrase = (pctBelow != null) ? ' (' + pct(pctBelow) + ' below list)' : '';
        f.Description__c = 'Renewal Quote Line priced at ' + money(netPrice) +
            ' against a current list of ' + money(listPrice) + pctPhrase + '. ' +
            'Annual exposure on this line: ' + money(gap) + '. ' +
            'Either capture an approval for the discount or restore list pricing on renewal.';
    }

    private static void renderOrderNoBilling(ForensicFinding__c f, Map<String, Object> m) {
        Object days = m.get('daysSinceActivation');
        Object items = m.get('itemCount');
        Decimal gap = scale2(f.GapUsd__c);
        String dayPhrase = (days != null) ? days + ' days ago' : 'previously';
        String itemPhrase = (items != null) ? items + ' OrderItem(s)' : 'OrderItems';
        f.Description__c = 'Order was activated ' + dayPhrase +
            ' with ' + itemPhrase + ' but no billing schedule was generated. ' +
            'Unbilled revenue: ' + money(gap) + '. ' +
            'Inspect the Order Activation flow / trigger and the BillingRule lookup on each OrderItem.';
    }

    private static void renderQOVariance(ForensicFinding__c f, Map<String, Object> m) {
        Decimal qNet = toDec(m.get('quoteNetAmount'));
        Decimal oTot = toDec(m.get('orderTotal'));
        Decimal delta = toDec(m.get('delta'));
        String dir = (String) m.get('direction');
        String dirPhrase = (dir == 'over_billed') ? 'over-billed' : 'under-billed';
        f.Description__c = 'Quote was approved at ' + money(qNet) +
            ' but the activated Order(s) totalled ' + money(oTot) +
            ' — customer is being ' + dirPhrase + ' by ' + money(delta) + '. ' +
            'Inspect the Q→O field mapping and any Apex/Flow that rewrites prices on Order.';
    }

    private static void renderAmendmentVariance(ForensicFinding__c f, Map<String, Object> m) {
        Decimal qNet = toDec(m.get('quoteNetAmount'));
        Decimal oTot = toDec(m.get('orderTotal'));
        Decimal delta = toDec(m.get('delta'));
        String dir = (String) m.get('direction');
        String dirPhrase = (dir == 'over_billed') ? 'over-billed' : 'under-billed';
        f.Description__c = 'Amendment Quote expected to add ' + money(qNet) +
            ' but the resulting Order delta is ' + money(oTot) +
            ' — customer ' + dirPhrase + ' by ' + money(delta) + ' on this amendment. ' +
            'Inspect the amendment Q→O conversion and SBQQ__Existing__c flags on the amendment lines.';
    }

    // ─── Formatting helpers ────────────────────────────────────────────

    @TestVisible
    static String money(Object v) {
        Decimal d = toDec(v);
        if (d == null) return '$0';
        Boolean negative = d < 0;
        Decimal abs1 = negative ? d.abs() : d;
        // Whole vs partial: hide cents on round numbers, keep them otherwise.
        String body = (abs1 == abs1.setScale(0))
            ? formatWithCommas(abs1.setScale(0))
            : formatWithCommas(abs1.setScale(2));
        return (negative ? '-$' : '$') + body;
    }

    @TestVisible
    static String pct(Decimal d) {
        if (d == null) return '';
        // Heuristic: detectors emit pct as 25 (=25%) more often than 0.25.
        Decimal v = (d.abs() <= 1) ? d * 100 : d;
        return v.setScale(1) + '%';
    }

    @TestVisible
    static Decimal toDec(Object v) {
        if (v == null) return null;
        if (v instanceof Decimal) return (Decimal) v;
        if (v instanceof Integer) return ((Integer) v) + 0.0;
        if (v instanceof Long) return ((Long) v) + 0.0;
        if (v instanceof Double) return Decimal.valueOf((Double) v);
        if (v instanceof String) {
            try { return Decimal.valueOf((String) v); }
            catch (Exception e) { return null; }
        }
        return null;
    }

    @TestVisible
    static Decimal scale2(Decimal d) {
        return d == null ? 0 : d.setScale(2);
    }

    @TestVisible
    static String formatWithCommas(Decimal d) {
        if (d == null) return '0';
        // Apex doesn't ship a locale-aware grouping formatter — roll our
        // own thousands separator for the integer part.
        String raw = d.toPlainString();
        Boolean hasFrac = raw.contains('.');
        String intPart = hasFrac ? raw.substringBefore('.') : raw;
        String fracPart = hasFrac ? raw.substringAfter('.') : '';
        String body = '';
        Integer n = intPart.length();
        for (Integer i = 0; i < n; i++) {
            if (i > 0 && Math.mod(n - i, 3) == 0) body += ',';
            body += intPart.substring(i, i + 1);
        }
        return hasFrac ? body + '.' + fracPart : body;
    }
}
