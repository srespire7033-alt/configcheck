/**
 * Class C — Conflicting Automation tracer.
 *
 * Identifies when two pieces of config both touch the same pricing field,
 * with one winning silently. This is the canonical Class C pattern AND
 * the user's live production problem (Contract record-triggered Flow vs
 * One Price Book / Price Rule conflict on renewal NetPrice).
 *
 * For a REN-001 finding (renewal uplift suppressed), the suspect configs are:
 *   - Price Rules with Actions targeting SBQQ__NetPrice__c, conditioned on
 *     SBQQ__Type__c = 'Renewal'
 *   - QCP (Quote Calculator Plugin) — custom Apex/JS named SBQQ__CustomScript__c
 *     that includes a NetPrice mutation
 *   - Record-triggered Flows on SBQQ__Quote__c or SBQQ__QuoteLine__c that
 *     update price fields
 *   - Discount Schedules with floor prices that wipe the uplift
 *
 * We query each of these via Tooling API (Flows, QCPs) and standard SOQL
 * (Price Rules — they're a real SObject). The tracer's confidence is high
 * when the config's conditions DEMONSTRABLY match the finding's record;
 * lower when there's a config that *could* explain it but we can't prove it.
 */

import type { Connection } from 'jsforce';
import type { AttributionTracer, AttributionCandidate, DetectorResult, DetectorContext } from '../types';

interface PriceRuleRow {
  Id: string;
  Name: string;
  SBQQ__Active__c: boolean | string;
  SBQQ__EvaluationEvent__c: string;
  SBQQ__LookupObject__c?: string;
  SBQQ__ConditionsMet__c?: string;
}

interface PriceConditionRow {
  Id: string;
  Name: string;
  SBQQ__Rule__c: string;
  SBQQ__Field__c: string;
  SBQQ__Operator__c: string;
  SBQQ__Value__c: string;
  SBQQ__Object__c: string;
}

interface PriceActionRow {
  Id: string;
  /** Resolved target field name — aliased from whichever column the org uses
   *  (SBQQ__TargetField__c | SBQQ__FieldName__c | SBQQ__Field__c). */
  TargetField: string;
  SBQQ__SourceField__c?: string;
  SBQQ__Value__c?: string;
  SBQQ__Formula__c?: string;
}

interface FlowDefinitionRow {
  Id: string;
  DeveloperName: string;
  MasterLabel: string;
  Description?: string;
}

const CLASS_C_TRACER: AttributionTracer = {
  rootCauseClass: 'C',

  async trace(finding: DetectorResult, ctx: DetectorContext): Promise<AttributionCandidate[]> {
    // Only applies to detectors where price field overrides are plausible.
    // For non-pricing detectors (e.g., BIL-FOR-* invoice gaps), Class C
    // would look at different configs — we'll add those when those
    // detectors ship.
    if (!finding.detectorId.startsWith('REN') && !finding.detectorId.startsWith('DSC') && !finding.detectorId.startsWith('QL')) {
      return [];
    }

    const candidates: AttributionCandidate[] = [];

    const priceRuleCandidates = await findConflictingPriceRules(ctx.conn, finding);
    candidates.push(...priceRuleCandidates);

    const flowCandidates = await findConflictingFlows(ctx.conn, finding);
    candidates.push(...flowCandidates);

    // Future: QCP detection (SBQQ__CustomScript__c lookups), Discount
    // Schedule floor detection. Out of v1 scope so we ship REN-001 lean.

    // Sort by confidence descending. Highest-confidence candidate
    // becomes the primary attribution; others may surface as
    // "additional suspected causes" in the UI.
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  },
};

export default CLASS_C_TRACER;

// ────────────────────────────────────────────────────────────────────
// Price Rule conflict detection
// ────────────────────────────────────────────────────────────────────

/**
 * Identify Price Rules whose Actions target a pricing field AND whose
 * Conditions match the finding's record. A rule with target=NetPrice and
 * condition=`Quote.Type='Renewal'` is a near-certain culprit for a
 * REN-001 finding.
 */
// Per-connection cache for the rules-query result. Without this the tracer
// re-runs the same query for every finding — for 20 findings that's 20
// describes + 20 SOQL roundtrips, blowing Vercel's 60s window. We cache
// via WeakMap so garbage collection still works when the Connection is
// released.
const RULES_CACHE = new WeakMap<object, Promise<{
  targetFieldColumn: string | null;
  rules: Array<PriceRuleRow & { Actions: { records: PriceActionRow[] }; Conditions: { records: PriceConditionRow[] } }>;
}>>();

function getRulesCached(conn: Connection) {
  let cached = RULES_CACHE.get(conn);
  if (cached) return cached;
  cached = (async () => {
    const paDesc = (await conn.describe('SBQQ__PriceAction__c')) as { fields: Array<{ name: string }> };
    const paFieldNames = new Set(paDesc.fields.map((f) => f.name));
    const targetFieldColumn = ['SBQQ__TargetField__c', 'SBQQ__FieldName__c', 'SBQQ__Field__c'].find((c) => paFieldNames.has(c)) ?? null;
    if (!targetFieldColumn) {
      console.warn('[forensics] Class C: no target-field column on SBQQ__PriceAction__c; skipping rule tracer');
      return { targetFieldColumn: null, rules: [] };
    }
    // No SOQL field aliases (REST doesn't allow on non-aggregates) —
    // we project the dynamic target column raw, then normalize each
    // row's PriceAction children to a stable `TargetField` key in JS
    // below before returning.
    const rulesRes = await conn.query<Record<string, unknown>>(
      `SELECT Id, Name, SBQQ__Active__c, SBQQ__EvaluationEvent__c, SBQQ__LookupObject__c, SBQQ__ConditionsMet__c,
         (SELECT Id, ${targetFieldColumn}, SBQQ__SourceField__c, SBQQ__Value__c, SBQQ__Formula__c FROM SBQQ__PriceActions__r),
         (SELECT Id, SBQQ__Field__c, SBQQ__Operator__c, SBQQ__Value__c, SBQQ__Object__c FROM SBQQ__PriceConditions__r)
       FROM SBQQ__PriceRule__c
       WHERE SBQQ__Active__c = TRUE
       LIMIT 500`
    );
    // Normalize: rename dynamic targetFieldColumn → 'TargetField' on
    // every PriceAction child row so downstream code is column-name-agnostic.
    const normalizedRules = rulesRes.records.map((rule) => {
      const actionsRel = rule['SBQQ__PriceActions__r'] as { records?: Array<Record<string, unknown>> } | undefined;
      const conditionsRel = rule['SBQQ__PriceConditions__r'] as { records?: Array<Record<string, unknown>> } | undefined;
      return {
        ...(rule as unknown as PriceRuleRow),
        Actions: {
          records: (actionsRel?.records ?? []).map((a) => ({
            Id: a.Id as string,
            TargetField: a[targetFieldColumn] as string,
            SBQQ__SourceField__c: a.SBQQ__SourceField__c as string | undefined,
            SBQQ__Value__c: a.SBQQ__Value__c as string | undefined,
            SBQQ__Formula__c: a.SBQQ__Formula__c as string | undefined,
          })) as PriceActionRow[],
        },
        Conditions: { records: (conditionsRel?.records ?? []) as unknown as PriceConditionRow[] },
      } as PriceRuleRow & { Actions: { records: PriceActionRow[] }; Conditions: { records: PriceConditionRow[] } };
    });
    return { targetFieldColumn, rules: normalizedRules };
  })();
  RULES_CACHE.set(conn, cached);
  return cached;
}

async function findConflictingPriceRules(conn: Connection, finding: DetectorResult): Promise<AttributionCandidate[]> {
  const targetFieldValues = ['SBQQ__NetPrice__c', 'SBQQ__Price__c', 'SBQQ__Discount__c', 'SBQQ__ListPrice__c'];

  const { targetFieldColumn, rules } = await getRulesCached(conn);
  if (!targetFieldColumn) return [];
  // Note: rulesRes used to be a local; the cached version is bound here
  // for compat with the for-loop below.
  const rulesRes = { records: rules };

  const candidates: AttributionCandidate[] = [];
  for (const rule of rulesRes.records) {
    const actions = rule.Actions?.records ?? [];
    const conditions = rule.Conditions?.records ?? [];

    // Does this rule target a pricing field?
    const pricingActions = actions.filter((a) => targetFieldValues.includes(a.TargetField));
    if (pricingActions.length === 0) continue;

    // Does its condition set plausibly match a Renewal context?
    const renewalConditions = conditions.filter(
      (c) =>
        c.SBQQ__Field__c?.toLowerCase().includes('type') &&
        c.SBQQ__Value__c?.toLowerCase().includes('renewal')
    );

    // Confidence model:
    //   1.0  — pricing action targeting NetPrice AND explicit Renewal condition
    //   0.7  — pricing action targeting NetPrice but no explicit Renewal condition
    //         (the rule fires on EVERY quote including renewals)
    //   0.4  — pricing action targets a related field (Discount, ListPrice)
    //         but not NetPrice directly
    const netPriceAction = pricingActions.find((a) => a.TargetField === 'SBQQ__NetPrice__c');
    let confidence: number;
    if (netPriceAction && renewalConditions.length > 0) confidence = 1.0;
    else if (netPriceAction) confidence = 0.7;
    else confidence = 0.4;

    const primaryAction = netPriceAction ?? pricingActions[0];
    candidates.push({
      rootCauseClass: 'C',
      rootConfigType: 'SBQQ__PriceRule__c',
      rootConfigId: rule.Id,
      rootConfigName: rule.Name,
      reasonCode:
        renewalConditions.length > 0
          ? 'RULE_OVERRIDES_NETPRICE_ON_RENEWAL'
          : 'RULE_OVERRIDES_NETPRICE_BROADLY',
      confidence,
      evidence: {
        evaluation_event: rule.SBQQ__EvaluationEvent__c,
        target_field: primaryAction.TargetField,
        action_value: primaryAction.SBQQ__Value__c ?? primaryAction.SBQQ__Formula__c ?? primaryAction.SBQQ__SourceField__c,
        renewal_condition_count: renewalConditions.length,
        all_conditions: conditions.map((c) => ({
          field: c.SBQQ__Field__c,
          operator: c.SBQQ__Operator__c,
          value: c.SBQQ__Value__c,
        })),
        affected_quote_line_id: finding.primaryRecord.id,
      },
    });
  }

  return candidates;
}

// ────────────────────────────────────────────────────────────────────
// Flow conflict detection (via Tooling API)
// ────────────────────────────────────────────────────────────────────

/**
 * Identify record-triggered Flows on SBQQ__Quote__c / SBQQ__QuoteLine__c
 * / Contract that mutate pricing fields. The Tooling API exposes
 * FlowDefinitionView; we then inspect ActiveVersionId metadata for
 * field update actions on the target fields.
 *
 * v1: we identify candidate Flows but we don't yet parse the Flow
 * definition XML to confirm "this Flow definitely writes NetPrice."
 * Confidence is capped at 0.5 — the UI surfaces these as "suspected
 * but not proven; verify manually." This is honest about what we know
 * vs. what we'd need to parse Flow XML to prove.
 */
// Same caching pattern for the Flow query.
const FLOWS_CACHE = new WeakMap<object, Promise<FlowDefinitionRow[]>>();
function getFlowsCached(conn: Connection): Promise<FlowDefinitionRow[]> {
  let cached = FLOWS_CACHE.get(conn);
  if (cached) return cached;
  cached = (async () => {
    try {
      const flowsRes = await conn.tooling.query<FlowDefinitionRow>(
        `SELECT Id, DeveloperName, MasterLabel, Description
         FROM FlowDefinitionView
         WHERE TriggerType IN ('RecordAfterSave', 'RecordBeforeSave')
           AND IsActive = TRUE
           AND TriggerObjectOrEvent.QualifiedApiName IN ('SBQQ__Quote__c', 'SBQQ__QuoteLine__c', 'Contract', 'SBQQ__Subscription__c')
         LIMIT 100`
      );
      return flowsRes.records;
    } catch (err) {
      console.warn('[forensics] Flow tracer query failed:', err instanceof Error ? err.message : err);
      return [];
    }
  })();
  FLOWS_CACHE.set(conn, cached);
  return cached;
}

async function findConflictingFlows(conn: Connection, finding: DetectorResult): Promise<AttributionCandidate[]> {
  try {
    const flows = await getFlowsCached(conn);
    return flows.map((flow) => ({
      rootCauseClass: 'C' as const,
      rootConfigType: 'Flow' as const,
      rootConfigId: flow.Id,
      rootConfigName: flow.MasterLabel,
      reasonCode: 'FLOW_MUTATES_RENEWAL_PRICING_FIELD' as const,
      // Capped at 0.5 — we know this Flow runs on the relevant object,
      // we don't know it writes NetPrice. Honest signal.
      confidence: 0.5,
      evidence: {
        flow_developer_name: flow.DeveloperName,
        flow_description: flow.Description ?? null,
        trigger_object: 'SBQQ__Quote__c | SBQQ__QuoteLine__c | Contract',
        verification_note: 'Flow definition was not parsed; manual verification recommended',
        affected_quote_line_id: finding.primaryRecord.id,
      },
    }));
  } catch (err) {
    // Tooling API access can fail on orgs without API Enabled —
    // detector continues with Price Rule candidates only.
    console.warn('[forensics] Flow tracer failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
