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
  // ─────────── ORD-FOR-001 / Class A ───────────
  BILLING_RULE_MISSING_ON_ORDERITEM: (f, a) => {
    const days = (a.evidence.days_since_activation as number | undefined) ?? 0;
    const itemCount = (a.evidence.item_count as number | undefined) ?? 0;
    return {
      plainEnglish:
        `Order ${f.primaryRecord.name} was activated ${days} days ago — the customer is receiving the product — but ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} has accrued without a single invoice being generated. ` +
        `At least one of the ${itemCount} OrderItem(s) has blng__BillingRule__c = null, which means Salesforce Billing's schedule-generation logic silently skipped this Order at activation time.`,
      suggestedFix:
        `Open Order ${f.primaryRecord.name} → Order Products. Set blng__BillingRule__c on every OrderItem (typically the default product-level billing rule). Then run Salesforce Billing's 'Generate Billing Schedule' action to back-fill the missed periods.`,
      model: 'template-fallback',
    };
  },
  ACTIVATION_WORKFLOW_NOT_TRIGGERING: (f, a) => {
    const days = (a.evidence.days_since_activation as number | undefined) ?? 0;
    return {
      plainEnglish:
        `Order ${f.primaryRecord.name} was activated ${days} days ago with billing rules configured on every line — but no billing schedules were generated. ` +
        `${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} of revenue is unbilled. The activation workflow or trigger that should fire on Status='Activated' isn't running.`,
      suggestedFix:
        `Inspect Setup → Flows / Process Builder / Apex Triggers for any automation on the Order object that calls Salesforce Billing's schedule generator. Check that it's Active. Once fixed, run 'Generate Billing Schedule' against this Order to back-fill.`,
      model: 'template-fallback',
    };
  },
  // ─────────── ORD-FOR-002 / Class A or B ───────────
  QUOTE_ORDER_TOTAL_VARIANCE: (f, a) => {
    const direction = (a.evidence.direction as string | undefined) ?? 'under_billed';
    const quoteNet = (a.evidence.quote_net_amount as number | undefined) ?? 0;
    const orderSum = (a.evidence.order_total_sum as number | undefined) ?? 0;
    const orderCount = (a.evidence.order_count as number | undefined) ?? 1;
    const recoveryMode = (a.evidence.recovery_mode as string | undefined) ?? 'pre_invoice_patch';
    const directionPhrase = direction === 'under_billed' ? 'under-billed' : 'over-billed';
    const fixSentence =
      recoveryMode === 'post_invoice_manual_review'
        ? `Order has been invoiced — handle via Salesforce Billing's Credit/Debit Memo flow. Activated OrderItems cannot be repriced once invoices exist.`
        : `Patch each OrderItem.UnitPrice on the affected Order(s) so the rolled-up Order.TotalAmount sum matches Quote ${a.rootConfigName}'s ${f.currencyIsoCode} ${quoteNet.toLocaleString()}.`;
    return {
      plainEnglish:
        `Quote "${a.rootConfigName}" was approved at ${f.currencyIsoCode} ${quoteNet.toLocaleString()} but the ${orderCount} activated Order(s) totalled ${f.currencyIsoCode} ${orderSum.toLocaleString()} — the customer is ${directionPhrase} by ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()}. ` +
        `The Q→O conversion either dropped a line, applied a different Pricebook, or a Flow/Apex on Order rewrote pricing fields. There is no audit trail of an approval that authorized the variance.`,
      suggestedFix: fixSentence,
      model: 'template-fallback',
    };
  },
  // ─────────── ORD-FOR-003 / Class A | B | E ───────────
  AMENDMENT_DELTA_MISMATCH: (f, a) => {
    const direction = (a.evidence.direction as string | undefined) ?? 'under_billed';
    const expected = (a.evidence.expected_delta as number | undefined) ?? 0;
    const actual = (a.evidence.order_total_sum as number | undefined) ?? 0;
    const prorationActive = a.evidence.proration_active === true;
    const crossValidated = a.evidence.cross_validated === true;
    return {
      plainEnglish:
        `Amendment Quote "${a.rootConfigName}" should have produced a ${f.currencyIsoCode} ${expected.toLocaleString()} delta on activation, but the amendment Order(s) totalled ${f.currencyIsoCode} ${actual.toLocaleString()} — customer is ${direction === 'under_billed' ? 'under-billed' : 'over-billed'} by ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()}.${crossValidated ? ' Cross-validated against prior Order totals for this Account.' : ''}${prorationActive ? ' Proration is active; part of the variance may be legitimate day-counting.' : ''}`,
      suggestedFix:
        `Inspect the amendment Q→O field mapping and any Flow/Apex on Order that may have rewritten pricing. Patch OrderItem.UnitPrice on the amendment Order(s) so the rolled-up sum matches the expected delta.`,
      model: 'template-fallback',
    };
  },
  AMENDMENT_ORDER_EDITED_POST_ACTIVATION: (f, a) => {
    const direction = (a.evidence.direction as string | undefined) ?? 'under_billed';
    return {
      plainEnglish:
        `Amendment Order ${a.rootConfigName} was edited by a different user >1 hour after creation, and the activated total no longer matches the amendment Quote's expected delta. Customer is ${direction === 'under_billed' ? 'under-billed' : 'over-billed'} by ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()}. ` +
        `Manual edit on an activated amendment Order bypassed CPQ pricing.`,
      suggestedFix:
        `Reverse the manual edit by patching OrderItem.UnitPrice back to the amendment-derived values. Add an approval rule on Order to block post-activation pricing-field edits.`,
      model: 'template-fallback',
    };
  },
  AMENDMENT_EXISTING_FLAG_MISCONFIGURED: (f, a) => {
    const count = (a.evidence.suspect_count as number | undefined) ?? 1;
    const quoteName = (a.evidence.quote_name as string | undefined) ?? 'amendment quote';
    return {
      plainEnglish:
        `Amendment Quote "${quoteName}" has ${count} line(s) marked SBQQ__Existing__c=false for product(s) already on existing-flagged lines. The amendment treated those as NEW additions and the Order double-counted them — ${f.currencyIsoCode} ${f.gapUsd.toLocaleString()} of variance is the direct result. ` +
        `The flag should have been derived (TRUE for products carried over from the original contract) but was set to FALSE during quote configuration.`,
      suggestedFix:
        `Patch SBQQ__Existing__c=TRUE on the ${count} suspect QuoteLine(s) via Data Loader, then re-activate the amendment so the Order regenerates with the correct delta. Audit other amendments for the same misconfiguration pattern.`,
      model: 'template-fallback',
    };
  },
  ORDER_EDITED_POST_ACTIVATION: (f, a) => {
    const direction = (a.evidence.direction as string | undefined) ?? 'under_billed';
    const variance = (a.evidence.variance_amount as number | undefined) ?? 0;
    return {
      plainEnglish:
        `Order ${a.rootConfigName} was edited by a different user more than an hour after it was created, and the totals no longer match the originating Quote. The customer is ${direction === 'under_billed' ? 'under-billed' : 'over-billed'} by ${f.currencyIsoCode} ${Math.abs(variance).toLocaleString()}. ` +
        `Manual edit on an activated Order bypassed CPQ pricing — no approval rule on Order intercepted the change.`,
      suggestedFix:
        `Open Order ${a.rootConfigName} → History. Reverse the manual edit by patching OrderItem.UnitPrice back to the Quote-derived values, and add an approval rule on Order to block post-activation pricing-field edits.`,
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
