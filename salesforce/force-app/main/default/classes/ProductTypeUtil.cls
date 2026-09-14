/**
 * Phase 27 — ProductType is a SET, not a scalar.
 *
 * ConnectedOrg__c.ProductType__c has always been a MultiselectPicklist whose
 * own description reads "one org can have CPQ + Billing + ARM all together",
 * and 65 of 229 Detector__mdt records are tagged for more than one stack. Only
 * the gate layer ever read it as a single token, comparing the WHOLE field
 * value with ==. That meant a legitimately dual-stack org ('CPQ;ARM') matched
 * no AppliesTo token at all and ran ZERO detectors, and a real customer org
 * with both stacks installed was forced into an arbitrary one — silently
 * skipping the other stack's entire detector family.
 *
 * Token vocabulary: CPQ, CPQ+Billing, ARM, Billing, None ('None' only ever
 * appears alone). Blank on either side means "no filter" — preserved from the
 * legacy behaviour so single-token callers are bit-for-bit unchanged.
 */
public with sharing class ProductTypeUtil {

    /** Split a stored multiselect value into its trimmed tokens. */
    public static Set<String> tokens(String raw) {
        Set<String> out = new Set<String>();
        if (String.isBlank(raw)) return out;
        for (String t : raw.split(';')) {
            if (String.isNotBlank(t.trim())) out.add(t.trim());
        }
        return out;
    }

    /**
     * Does a detector's declared AppliesTo list overlap the org's stacks?
     * Blank on EITHER side = "no filter" = true (legacy semantics).
     */
    public static Boolean intersects(String declaredList, String orgTypes) {
        if (String.isBlank(declaredList) || String.isBlank(orgTypes)) return true;
        return intersects(tokens(declaredList), orgTypes);
    }

    public static Boolean intersects(Set<String> declared, String orgTypes) {
        if (declared == null || declared.isEmpty() || String.isBlank(orgTypes)) return true;
        for (String t : tokens(orgTypes)) {
            if (declared.contains(t)) return true;
        }
        return false;
    }

    /** Is a specific token present in the org's stack set? */
    public static Boolean has(String orgTypes, String token) {
        return tokens(orgTypes).contains(token);
    }

    /**
     * The headline token, for display/badges/branching ONLY — never a gate.
     * Gating on primary() would reintroduce exactly the bug this class fixes.
     */
    public static String primary(String orgTypes) {
        for (String t : new List<String>{ 'CPQ', 'CPQ+Billing', 'ARM', 'Billing', 'None' }) {
            if (has(orgTypes, t)) return t;
        }
        return orgTypes;
    }
}
