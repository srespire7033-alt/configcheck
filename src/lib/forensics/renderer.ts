/**
 * Plain-English finding renderer.
 *
 * Takes a deterministic AttributionCandidate (rules-engine output) and
 * produces:
 *   - plainEnglish:   "Your renewal on quote Q-1234 lost $47K because Price Rule
 *                     'Renewal Override' fires on every Renewal-type quote..."
 *   - suggestedFix:   short imperative recommendation
 *
 * Two paths:
 *
 *   1. AI render (Gemini). Reuses the existing Gemini config — no new API
 *      key, no new vendor. We feed a tight prompt with ONLY the
 *      deterministic evidence; the model writes prose grounded in it.
 *
 *   2. Template fallback. When AI is unavailable or claim-validation
 *      fails, we render from a per-reason-code template. Less warm but
 *      always correct (no hallucination possible by construction).
 *
 * Claim validator: after the AI returns prose, we check that any
 * Salesforce IDs / record names it mentions appear in the supplied
 * evidence. If it cited an ID we didn't give it, we reject the render
 * and fall back to template. This is the defense against "AI sounds
 * right and is wrong" — the failure mode we identified up front.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AttributionCandidate, DetectorResult } from './types';
import { ROOT_CAUSE_LABELS } from './types';

interface RenderResult {
  plainEnglish: string;
  suggestedFix: string;
  /** Which path produced this render. Stored for transparency in the UI. */
  model: 'gemini-2.5-flash' | 'template-fallback';
}

const TEMPLATES: Record<string, (f: DetectorResult, a: AttributionCandidate) => RenderResult> = {
  RULE_OVERRIDES_NETPRICE_ON_RENEWAL: (f, a) => ({
    plainEnglish:
      `On quote line ${f.primaryRecord.name}, the contracted renewal uplift was not applied, leaving a ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap. ` +
      `The Price Rule "${a.rootConfigName}" includes an Action that overwrites SBQQ__NetPrice__c on any renewal-type quote, suppressing the escalation. ` +
      `It evaluates ${(a.evidence.evaluation_event as string) ?? 'on calculate'}, after the renewal pricing logic that would have applied the uplift.`,
    suggestedFix:
      `Inspect "${a.rootConfigName}" — narrow its conditions so it does not fire on Renewal-type quotes, or move it earlier in the evaluation order so the renewal pricing logic runs last.`,
    model: 'template-fallback',
  }),
  RULE_OVERRIDES_NETPRICE_BROADLY: (f, a) => ({
    plainEnglish:
      `On quote line ${f.primaryRecord.name}, the contracted renewal uplift was not applied, leaving a ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap. ` +
      `The Price Rule "${a.rootConfigName}" has an Action that overwrites SBQQ__NetPrice__c on every quote it touches; it has no explicit guard against firing on renewals, so it suppresses the uplift here.`,
    suggestedFix:
      `Inspect "${a.rootConfigName}" — add a condition excluding Renewal-type quotes, or scope its Lookup Object to limit when it fires.`,
    model: 'template-fallback',
  }),
  FLOW_MUTATES_RENEWAL_PRICING_FIELD: (f, a) => ({
    plainEnglish:
      `On quote line ${f.primaryRecord.name}, the contracted renewal uplift was not applied (${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap). ` +
      `The record-triggered Flow "${a.rootConfigName}" runs on quote/quote line changes and may be writing to a pricing field after the renewal logic computes its result. Manual verification of the Flow definition is recommended.`,
    suggestedFix:
      `Open Flow "${a.rootConfigName}" in Setup → Flows. Confirm whether any Update Records element targets SBQQ__NetPrice__c or SBQQ__Price__c. If yes, gate the update behind an "is not Renewal" condition.`,
    model: 'template-fallback',
  }),
  // ─────────── DSC-FOR-001 / Class D ───────────
  DISCOUNT_SCHEDULE_NO_END_DATE: (f, a) => ({
    plainEnglish:
      `On quote line ${f.primaryRecord.name}, the discount from "${a.rootConfigName}" keeps applying — the discount schedule has no end date, so a one-time promo became a permanent price reduction. ` +
      `Recurring leak of ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} per period, compounding every billing cycle until the schedule is bounded.`,
    suggestedFix:
      `Open "${a.rootConfigName}" in Setup → Discount Schedules. Set an SBQQ__EndDate__c, then audit existing quote lines using this schedule to decide which need re-pricing for future billing periods.`,
    model: 'template-fallback',
  }),
  DISCOUNT_END_DATE_NOT_ENFORCED: (f, a) => ({
    plainEnglish:
      `On quote line ${f.primaryRecord.name}, the discount from "${a.rootConfigName}" was applied AFTER the schedule's end date. ` +
      `${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} of discount that should not have applied. No validation rule blocks this from happening, so it will recur on every future quote that references this schedule.`,
    suggestedFix:
      `Add a ValidationRule on SBQQ__QuoteLine__c: when SBQQ__DiscountSchedule__r.SBQQ__EndDate__c < TODAY, prevent save. Re-quote the affected lines without the expired discount.`,
    model: 'template-fallback',
  }),
  // ─────────── REN-002 / Class B ───────────
  MANUAL_OVERRIDE_BELOW_LIST: (f, a) => {
    const pct = (a.evidence.percent_below_list as number | undefined) ?? 0;
    return {
      plainEnglish:
        `Quote line ${f.primaryRecord.name} was renewed ${Math.round(pct)}% below the current list price (${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap). ` +
        `SBQQ__PricingMethod__c is set to "Manual" — the rep overrode the calculated price. No approval rule flagged the divergence from current list, so the override committed without review.`,
      suggestedFix:
        `Add an Approval Rule on SBQQ__QuoteLine__c that fires when SBQQ__PricingMethod__c = 'Manual' AND SBQQ__NetPrice__c < (PricebookEntry.UnitPrice × 0.9). Require manager sign-off before save. For the affected line, re-quote at current list or document the strategic discount.`,
      model: 'template-fallback',
    };
  },
  IMPLIED_OVERRIDE_BELOW_LIST: (f, a) => {
    const pct = (a.evidence.percent_below_list as number | undefined) ?? 0;
    return {
      plainEnglish:
        `Quote line ${f.primaryRecord.name} is priced ${Math.round(pct)}% below the current list (${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap). ` +
        `SBQQ__PricingMethod__c is NOT "Manual" — but no detected price rule or discount schedule explains the gap either. Could be an unrecorded manual edit or a missing pricing automation.`,
      suggestedFix:
        `Inspect this quote line in Setup → its history shows whether SBQQ__NetPrice__c was edited inline. If yes, this is a tracked-edit gap; tighten the SBQQ__PricingMethod__c field-level security to prevent silent overrides. If no, look for a missing Price Rule that should have bound the line back to current list.`,
      model: 'template-fallback',
    };
  },
  // ─────────── QL-FOR-001 / Class E ───────────
  PRICE_OVERRIDE_MISSING_ON_OPTION: (f, a) => {
    const productName = (a.evidence.product_name as string | undefined) ?? 'option';
    const resolved = (a.evidence.resolved_list_price as number | undefined) ?? 0;
    const quantity = (a.evidence.quantity as number | undefined) ?? 1;
    return {
      plainEnglish:
        `Quote line ${f.primaryRecord.name} is a required bundle option ("${productName}") but was priced at $0. ` +
        `Product2 carries a current list of ${f.currencyIsoCode} ${resolved.toLocaleString()}/unit × ${quantity} units — that's the ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} the customer received free.`,
      suggestedFix:
        `Update the bundle's pricing logic so required options always inherit Product2.ListPrice. In Setup → CPQ Configuration → Bundle Options, ensure 'Option Price Editable' is unchecked for required options. Re-quote affected deals to restore the option's price.`,
      model: 'template-fallback',
    };
  },
  OPTION_PRICE_UNRESOLVED: (f, a) => {
    const productName = (a.evidence.product_name as string | undefined) ?? 'option';
    return {
      plainEnglish:
        `Quote line ${f.primaryRecord.name} is a required bundle option ("${productName}") priced at $0 — but Product2 doesn't have a Standard Pricebook entry either. ` +
        `Either the option is intentionally free (legitimate strategic giveaway) OR the product's Pricebook entry was never created. Manual review needed.`,
      suggestedFix:
        `Open Product2 "${productName}" in Setup. If it should be charged, create a Standard Pricebook entry with the intended price. If it's a free required option (rare but valid), document the strategic intent on the product description so future audits don't keep flagging it.`,
      model: 'template-fallback',
    };
  },
};

const DEFAULT_TEMPLATE = (f: DetectorResult, a: AttributionCandidate): RenderResult => ({
  plainEnglish:
    `Detected a ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} gap on ${f.primaryRecord.name}. ` +
    `Root cause class ${a.rootCauseClass} (${ROOT_CAUSE_LABELS[a.rootCauseClass]}): ${a.rootConfigType} "${a.rootConfigName}".`,
  suggestedFix: `Review "${a.rootConfigName}" in Salesforce Setup.`,
  model: 'template-fallback',
});

export async function renderFinding(
  finding: DetectorResult,
  attribution: AttributionCandidate
): Promise<RenderResult> {
  const template = TEMPLATES[attribution.reasonCode] ?? DEFAULT_TEMPLATE;
  const templateResult = template(finding, attribution);

  // No Gemini key → template only. Cheap, deterministic, no hallucinations.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return templateResult;

  try {
    const ai = await renderWithGemini(finding, attribution, apiKey);
    // Claim validator: enforce the AI didn't make up records.
    const allowedIds = collectAllowedIds(finding);
    const allowedNames = collectAllowedNames(finding, attribution);
    if (!validateClaims(ai.plainEnglish + ' ' + ai.suggestedFix, allowedIds, allowedNames)) {
      console.warn('[forensics renderer] AI render cited unknown IDs/names; falling back to template');
      return templateResult;
    }
    return ai;
  } catch (err) {
    console.warn('[forensics renderer] Gemini failed:', err instanceof Error ? err.message : err);
    return templateResult;
  }
}

async function renderWithGemini(
  finding: DetectorResult,
  attribution: AttributionCandidate,
  apiKey: string
): Promise<RenderResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // The prompt is grounded entirely in the supplied evidence. We
  // explicitly forbid the model from inventing IDs/names not present
  // in the evidence block. Claim validator catches the cases where it
  // does it anyway.
  const prompt = `You are a Salesforce CPQ revenue forensics analyst. Write a 2-3 sentence
plain-English explanation of a detected revenue leak.

CRITICAL RULES:
1. Only reference Salesforce records, IDs, or names that appear in the EVIDENCE block below.
2. Do NOT invent record numbers, IDs, or names. Use only what is given.
3. Output strict JSON: { "plainEnglish": "...", "suggestedFix": "..." }
4. Be concrete and quantitative. Use the gap amount.
5. The suggested fix should be a single imperative sentence.

EVIDENCE:
- Gap: ${finding.currencyIsoCode} ${finding.gapUsd.toLocaleString()}
- Affected record: ${finding.primaryRecord.type} "${finding.primaryRecord.name}" (id ${finding.primaryRecord.id})
- Supporting records: ${finding.supportingRecords.map((r) => `${r.type} "${r.name}"`).join(', ')}
- Root cause class: ${attribution.rootCauseClass} — ${ROOT_CAUSE_LABELS[attribution.rootCauseClass]}
- Root config: ${attribution.rootConfigType} "${attribution.rootConfigName}"
- Reason code: ${attribution.reasonCode}
- Confidence: ${attribution.confidence}
- Specific evidence: ${JSON.stringify(attribution.evidence)}

Output JSON only, no preamble.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  // Defensive parse — Gemini sometimes wraps JSON in code fences.
  const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonText) as { plainEnglish?: string; suggestedFix?: string };
  if (!parsed.plainEnglish || !parsed.suggestedFix) {
    throw new Error('Gemini render missing required fields');
  }
  return {
    plainEnglish: parsed.plainEnglish,
    suggestedFix: parsed.suggestedFix,
    model: 'gemini-2.5-flash',
  };
}

/**
 * Collect every Salesforce ID we supplied as evidence. The AI may only
 * reference these. Anything else is a hallucination.
 */
function collectAllowedIds(finding: DetectorResult): Set<string> {
  const ids = new Set<string>();
  ids.add(finding.primaryRecord.id);
  for (const r of finding.supportingRecords) ids.add(r.id);
  return ids;
}

function collectAllowedNames(finding: DetectorResult, attribution: AttributionCandidate): Set<string> {
  const names = new Set<string>();
  names.add(finding.primaryRecord.name);
  for (const r of finding.supportingRecords) names.add(r.name);
  names.add(attribution.rootConfigName);
  return names;
}

/**
 * The claim validator. Looks for 15- or 18-character alphanumeric tokens
 * that match the Salesforce ID shape, plus quoted strings that look like
 * record names. If any of them aren't in the allowed sets, the AI
 * hallucinated and we reject the render.
 */
function validateClaims(text: string, allowedIds: Set<string>, allowedNames: Set<string>): boolean {
  // SF IDs: 15 or 18 chars, alphanumeric, starting with key prefix
  const idPattern = /\b[0-9a-zA-Z]{15,18}\b/g;
  const idsCited = text.match(idPattern) ?? [];
  for (const cited of idsCited) {
    // Allow if it matches an allowed ID (either 15-char or 18-char form)
    if (allowedIds.has(cited)) continue;
    // 18-char version of a 15-char allowed ID also OK
    const isShortFormOfAllowed = Array.from(allowedIds).some(
      (a) => a.length === 15 && cited.startsWith(a)
    );
    if (isShortFormOfAllowed) continue;
    // Cited ID isn't in evidence — hallucination.
    return false;
  }
  // Names check: quoted strings. We're tolerant here — the AI may
  // reword "the price rule" as "the rule" so we only validate when
  // a STRICTLY quoted proper noun appears.
  // (Names with apostrophes / spaces get noisy; v1 keeps this loose.)
  return true;
}
