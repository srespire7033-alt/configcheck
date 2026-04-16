/**
 * ═══════════════════════════════════════════════════════════════════
 * INTEGRATION TESTS — Full Engine Scan Scenarios
 * ═══════════════════════════════════════════════════════════════════
 *
 * These tests run the FULL analysis engine end-to-end against
 * realistic CPQ configurations. They validate:
 *   ✅ Healthy orgs score well (no false positives)
 *   ❌ Problematic orgs are correctly flagged (detection works)
 *   🔀 Mixed orgs get proportional scores
 *   📊 Scoring, severity, category mapping all work together
 */

import { describe, it, expect } from 'vitest';
import { runAnalysis } from '@/lib/analysis/engine';
import { createCleanData, createProblematicData } from './fixtures';

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: Healthy Org — Zero Issues Expected
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Healthy CPQ Org (Negative Testing — No Issues)', () => {
  it('Approval Rules: well-configured rules should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const arIssues = result.issues.filter((i) => i.category === 'approval_rules');
    expect(arIssues).toHaveLength(0);
    expect(result.category_scores.approval_rules).toBe(100);
  });

  it('Summary Variables: properly referenced variables should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const svIssues = result.issues.filter((i) => i.category === 'summary_variables');
    expect(svIssues).toHaveLength(0);
    expect(result.category_scores.summary_variables).toBe(100);
  });

  it('Guided Selling: active process with inputs and outputs should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const gsIssues = result.issues.filter((i) => i.category === 'guided_selling');
    expect(gsIssues).toHaveLength(0);
    expect(result.category_scores.guided_selling).toBe(100);
  });

  it('Quote Templates: default active template with sections should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const qtIssues = result.issues.filter((i) => i.category === 'quote_templates');
    expect(qtIssues).toHaveLength(0);
    expect(result.category_scores.quote_templates).toBe(100);
  });

  it('QCP: single script with code and transpiled version should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const qcpIssues = result.issues.filter((i) => i.category === 'quote_calculator_plugin');
    expect(qcpIssues).toHaveLength(0);
    expect(result.category_scores.quote_calculator_plugin).toBe(100);
  });

  it('Overall health score should be >= 80 for a clean org', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    expect(result.overall_score).toBeGreaterThanOrEqual(80);
  });

  it('Zero critical issues in a healthy org', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const criticals = result.issues.filter((i) => i.severity === 'critical');
    expect(criticals).toHaveLength(0);
  });

  it('Complexity should be Low for a minimal org', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    expect(result.complexity!.rating).toBe('Low');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: Problematic Org — Issues Must Be Detected
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Problematic CPQ Org (Positive Testing — Issues Detected)', () => {
  // ── Approval Rules detection ──
  it('DETECT: Approval rule without approver (AR-001) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ar001 = result.issues.filter((i) => i.check_id === 'AR-001');
    expect(ar001.length).toBeGreaterThan(0);
    expect(ar001[0].severity).toBe('critical');
    expect(ar001[0].category).toBe('approval_rules');
  });

  it('DETECT: Approval rule without conditions (AR-002) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ar002 = result.issues.filter((i) => i.check_id === 'AR-002');
    expect(ar002.length).toBeGreaterThan(0);
    expect(ar002[0].severity).toBe('warning');
  });

  it('DETECT: Duplicate approval evaluation order (AR-003) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ar003 = result.issues.filter((i) => i.check_id === 'AR-003');
    expect(ar003.length).toBeGreaterThan(0);
  });

  it('DETECT: Missing condition logic on approval rule (AR-004) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ar004 = result.issues.filter((i) => i.check_id === 'AR-004');
    expect(ar004.length).toBeGreaterThan(0);
  });

  // ── Summary Variables detection ──
  it('DETECT: Orphaned summary variables (SV-001) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv001 = result.issues.filter((i) => i.check_id === 'SV-001');
    expect(sv001.length).toBeGreaterThan(0);
    expect(sv001[0].affected_records.length).toBeGreaterThan(5);
  });

  it('DETECT: Incomplete summary variable config (SV-002) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv002 = result.issues.filter((i) => i.check_id === 'SV-002');
    expect(sv002.length).toBeGreaterThan(0);
    expect(sv002[0].severity).toBe('critical');
  });

  it('DETECT: Duplicate summary variables (SV-003) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv003 = result.issues.filter((i) => i.check_id === 'SV-003');
    expect(sv003.length).toBeGreaterThan(0);
  });

  it('DETECT: Filter misconfiguration on summary variable (SV-004) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv004 = result.issues.filter((i) => i.check_id === 'SV-004');
    expect(sv004.length).toBeGreaterThan(0);
  });

  it('DETECT: Composite variable missing operand (SV-005) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv005 = result.issues.filter((i) => i.check_id === 'SV-005');
    expect(sv005.length).toBeGreaterThan(0);
    expect(sv005[0].severity).toBe('critical');
  });

  // ── Guided Selling detection ──
  it('DETECT: Guided selling without inputs (GS-001) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const gs001 = result.issues.filter((i) => i.check_id === 'GS-001');
    expect(gs001.length).toBeGreaterThan(0);
    expect(gs001[0].severity).toBe('critical');
  });

  it('DETECT: Guided selling without outputs (GS-002) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const gs002 = result.issues.filter((i) => i.check_id === 'GS-002');
    expect(gs002.length).toBeGreaterThan(0);
  });

  it('DETECT: Inactive guided selling processes (GS-003) → info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const gs003 = result.issues.filter((i) => i.check_id === 'GS-003');
    expect(gs003.length).toBeGreaterThan(0);
    expect(gs003[0].severity).toBe('info');
  });

  // ── Quote Templates detection ──
  it('DETECT: No default quote template (QT-001) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qt001 = result.issues.filter((i) => i.check_id === 'QT-001');
    expect(qt001.length).toBeGreaterThan(0);
  });

  it('DETECT: Non-active quote template (QT-002) → info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qt002 = result.issues.filter((i) => i.check_id === 'QT-002');
    expect(qt002.length).toBeGreaterThan(0);
  });

  it('DETECT: Empty quote template with no sections (QT-003) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qt003 = result.issues.filter((i) => i.check_id === 'QT-003');
    expect(qt003.length).toBeGreaterThan(0);
  });

  // ── QCP detection ──
  it('DETECT: Empty QCP script with no code (QCP-001) → critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qcp001 = result.issues.filter((i) => i.check_id === 'QCP-001');
    expect(qcp001.length).toBeGreaterThan(0);
    expect(qcp001[0].severity).toBe('critical');
  });

  it('DETECT: QCP missing transpiled code (QCP-002) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qcp002 = result.issues.filter((i) => i.check_id === 'QCP-002');
    expect(qcp002.length).toBeGreaterThan(0);
  });

  it('DETECT: QCP with performance concerns (QCP-003) → warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qcp003 = result.issues.filter((i) => i.check_id === 'QCP-003');
    expect(qcp003.length).toBeGreaterThan(0);
  });

  it('DETECT: Multiple QCP scripts (QCP-004) → info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const qcp004 = result.issues.filter((i) => i.check_id === 'QCP-004');
    expect(qcp004.length).toBeGreaterThan(0);
    expect(qcp004[0].severity).toBe('info');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Score Impact — Severity Affects Category Scores
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Score Impact Validation', () => {
  it('Approval Rules score drops below 100 when issues detected', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    expect(result.category_scores.approval_rules).toBeLessThan(100);
  });

  it('Summary Variables score drops significantly with critical issues', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    // Has SV-002 (critical: -15 each), SV-001 (warning: -5), SV-003 (warning: -5), SV-004 (warning: -5), SV-005 (critical: -15)
    expect(result.category_scores.summary_variables).toBeLessThan(70);
  });

  it('Guided Selling score drops with critical input/output issues', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    // GS-001 critical (-15), GS-002 critical (-15), GS-003 info (-1)
    expect(result.category_scores.guided_selling).toBeLessThanOrEqual(70);
  });

  it('Quote Templates score drops with missing default and empty template', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    expect(result.category_scores.quote_templates).toBeLessThan(100);
  });

  it('QCP score drops with empty script and performance issues', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    // QCP-001 critical (-15), QCP-002 warning (-5), QCP-003 warning (-5), QCP-004 info (-1)
    expect(result.category_scores.quote_calculator_plugin).toBeLessThanOrEqual(80);
  });

  it('Overall score for problematic org is meaningfully lower than healthy org', async () => {
    const cleanResult = await runAnalysis(createCleanData());
    const badResult = await runAnalysis(createProblematicData());

    expect(cleanResult.overall_score).toBeGreaterThan(badResult.overall_score);
    expect(cleanResult.overall_score - badResult.overall_score).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: Mixed Org — Selective Issues
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Mixed Org — Some Categories Clean, Some Broken', () => {
  it('Org with ONLY broken approval rules — other categories stay at 100', async () => {
    const data = createCleanData();
    // Break only approval rules
    data.approvalRules = [
      { Id: 'ar1', Name: 'No Approver', SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1, SBQQ__Approver__c: null, SBQQ__ApproverField__c: null, SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: 1, SBQQ__ApprovalChain__c: null, SBQQ__ApprovalConditions__r: { records: [{ Id: 'ac1', SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '1000', SBQQ__TestedVariable__c: null }] } },
    ];
    const result = await runAnalysis(data);

    // Approval rules should be impacted
    expect(result.category_scores.approval_rules).toBeLessThan(100);
    // Other 4 categories should stay perfect
    expect(result.category_scores.summary_variables).toBe(100);
    expect(result.category_scores.guided_selling).toBe(100);
    expect(result.category_scores.quote_templates).toBe(100);
    expect(result.category_scores.quote_calculator_plugin).toBe(100);
  });

  it('Org with ONLY broken QCP — approval rules stay at 100', async () => {
    const data = createCleanData();
    // Break only QCP
    data.customScripts = [
      { Id: 'cs1', Name: 'Empty Script', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
    ];
    const result = await runAnalysis(data);

    expect(result.category_scores.quote_calculator_plugin).toBeLessThan(100);
    expect(result.category_scores.approval_rules).toBe(100);
    expect(result.category_scores.summary_variables).toBe(100);
  });

  it('Org with broken guided selling only — templates and QCP stay clean', async () => {
    const data = createCleanData();
    data.guidedSellingProcesses = [
      { Id: 'gs1', Name: 'No Inputs', SBQQ__Active__c: true, SBQQ__LabelPosition__c: 'Top', SBQQ__Description__c: '', inputCount: 0, outputCount: 0 },
    ];
    const result = await runAnalysis(data);

    expect(result.category_scores.guided_selling).toBeLessThan(100);
    expect(result.category_scores.quote_templates).toBe(100);
    expect(result.category_scores.quote_calculator_plugin).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: Edge Cases & Boundary Conditions
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Edge Cases & Boundaries', () => {
  it('Empty org (no data at all) should score 100 — nothing to flag', async () => {
    const data = createCleanData();
    data.approvalRules = [];
    data.summaryVariables = [];
    data.guidedSellingProcesses = [];
    data.quoteTemplates = [];
    data.customScripts = [];
    const result = await runAnalysis(data);

    expect(result.category_scores.approval_rules).toBe(100);
    expect(result.category_scores.summary_variables).toBe(100);
    expect(result.category_scores.guided_selling).toBe(100);
    expect(result.category_scores.quote_templates).toBe(100);
    expect(result.category_scores.quote_calculator_plugin).toBe(100);
  });

  it('Category score never goes below 0 even with many issues', async () => {
    const data = createCleanData();
    // Add 20 critical approval rules (20 * -15 = -300, should clamp to 0)
    data.approvalRules = Array.from({ length: 20 }, (_, i) => ({
      Id: `ar${i}`, Name: `Bad Rule ${i}`, SBQQ__Active__c: true, SBQQ__ApprovalStep__c: 1,
      SBQQ__Approver__c: null, SBQQ__ApproverField__c: null,
      SBQQ__ConditionsMet__c: 'All', SBQQ__EvaluationOrder__c: i + 1,
      SBQQ__ApprovalChain__c: null,
      SBQQ__ApprovalConditions__r: { records: [{ Id: `ac${i}`, SBQQ__TestedField__c: 'Amount', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '1000', SBQQ__TestedVariable__c: null }] },
    }));
    const result = await runAnalysis(data);
    expect(result.category_scores.approval_rules).toBe(0);
    expect(result.category_scores.approval_rules).toBeGreaterThanOrEqual(0);
  });

  it('Category score never exceeds 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    for (const [, score] of Object.entries(result.category_scores)) {
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('All issues have required fields populated', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);

    for (const issue of result.issues) {
      expect(issue.check_id).toBeTruthy();
      expect(issue.category).toBeTruthy();
      expect(issue.severity).toMatch(/^(critical|warning|info)$/);
      expect(issue.title).toBeTruthy();
      expect(issue.description).toBeTruthy();
      expect(issue.affected_records).toBeInstanceOf(Array);
    }
  });

  it('Affected records always have id, name, and type', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);

    for (const issue of result.issues) {
      for (const record of issue.affected_records) {
        expect(record.id).toBeTruthy();
        expect(record.name).toBeTruthy();
        expect(record.type).toBeTruthy();
      }
    }
  });

  it('Duration is measured and positive', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Bundle Integrity (BN-001 to BN-004)
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Bundle Integrity — Positive & Negative', () => {
  // ── Negative: Healthy bundles score 100 ──
  it('Healthy bundles with proper options should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const bnIssues = result.issues.filter((i) => i.category === 'bundles');
    expect(bnIssues).toHaveLength(0);
    expect(result.category_scores.bundles).toBe(100);
  });

  it('No bundle issues when no products exist', async () => {
    const data = createCleanData();
    data.products = [];
    data.productOptions = [];
    const result = await runAnalysis(data);
    expect(result.category_scores.bundles).toBe(100);
  });

  // ── Positive: Problematic bundles drop score ──
  it('BN-001: Empty bundles are flagged as critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const bn001 = result.issues.filter((i) => i.check_id === 'BN-001');
    expect(bn001.length).toBeGreaterThan(0);
    expect(bn001[0].severity).toBe('critical');
    expect(bn001[0].category).toBe('bundles');
  });

  it('BN-002: Option with min > max quantity is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const bn002 = result.issues.filter((i) => i.check_id === 'BN-002');
    expect(bn002.length).toBeGreaterThan(0);
    expect(bn002[0].severity).toBe('warning');
  });

  it('BN-004: Required option without PBE is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const bn004 = result.issues.filter((i) => i.check_id === 'BN-004');
    expect(bn004.length).toBeGreaterThan(0);
    expect(bn004[0].severity).toBe('critical');
  });

  it('Bundle score drops below 100 with problematic data', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    expect(result.category_scores.bundles).toBeLessThan(100);
  });

  it('BN-005: Bundle with 5+ ungrouped options is flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const bn005 = result.issues.filter((i) => i.check_id === 'BN-005');
    expect(bn005.length).toBeGreaterThan(0);
    expect(bn005[0].severity).toBe('info');
    expect(bn005[0].category).toBe('bundles');
  });

  // ── Mixed: Only bundles broken, other categories unaffected ──
  it('Breaking only bundles does not affect lookup_queries score', async () => {
    const data = createCleanData();
    // Add empty bundle
    data.products.push({
      Id: 'p_broken', Name: 'Broken Bundle', ProductCode: 'BB', IsActive: true,
      SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null,
      SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null,
      SBQQ__PricingMethod__c: 'List', SBQQ__ConfigurationType__c: 'Allowed',
    });
    // Remove options for this bundle
    data.productOptions = data.productOptions.filter((o) => o.SBQQ__ConfiguredSKU__c !== 'p_broken');
    const result = await runAnalysis(data);
    expect(result.category_scores.bundles).toBeLessThan(100);
    expect(result.category_scores.lookup_queries).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: Lookup Queries (LQ-001 to LQ-004)
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: Lookup Queries — Positive & Negative', () => {
  // ── Negative: Clean lookup config scores 100 ──
  it('Clean price rules with no lookups should score 100', async () => {
    const data = createCleanData();
    const result = await runAnalysis(data);
    const lqIssues = result.issues.filter((i) => i.category === 'lookup_queries');
    expect(lqIssues).toHaveLength(0);
    expect(result.category_scores.lookup_queries).toBe(100);
  });

  it('No lookup issues when no price rules exist', async () => {
    const data = createCleanData();
    data.priceRules = [];
    data.productRules = [];
    const result = await runAnalysis(data);
    expect(result.category_scores.lookup_queries).toBe(100);
  });

  it('Properly configured lookup (object + source field) scores 100', async () => {
    const data = createCleanData();
    data.priceRules = [
      {
        Id: 'pr_good_lookup', Name: 'Good Lookup', SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: 10, SBQQ__TargetObject__c: 'Quote Line',
        SBQQ__LookupObject__c: 'Custom_Rate__c',
        SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__ProductCode__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: 'X', SBQQ__Object__c: 'Quote Line' }] },
        SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: null, SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: 'Rate__c' }] },
      },
    ];
    const result = await runAnalysis(data);
    const lqIssues = result.issues.filter((i) => i.category === 'lookup_queries');
    expect(lqIssues).toHaveLength(0);
    expect(result.category_scores.lookup_queries).toBe(100);
  });

  // ── Positive: Problematic lookups drop score ──
  it('LQ-001: Incomplete lookup (object but no source field) is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const lq001 = result.issues.filter((i) => i.check_id === 'LQ-001');
    expect(lq001.length).toBeGreaterThan(0);
    expect(lq001[0].severity).toBe('critical');
    expect(lq001[0].category).toBe('lookup_queries');
  });

  it('LQ-002: Orphaned lookup reference is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const lq002 = result.issues.filter((i) => i.check_id === 'LQ-002');
    expect(lq002.length).toBeGreaterThan(0);
    expect(lq002[0].severity).toBe('critical');
  });

  it('LQ-003: Selection rule missing target product is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const lq003 = result.issues.filter((i) => i.check_id === 'LQ-003');
    expect(lq003.length).toBeGreaterThan(0);
    expect(lq003[0].severity).toBe('warning');
  });

  it('LQ-004: Selection rule targeting inactive product is flagged', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const lq004 = result.issues.filter((i) => i.check_id === 'LQ-004');
    expect(lq004.length).toBeGreaterThan(0);
    expect(lq004[0].severity).toBe('warning');
  });

  it('LQ-005: Selection rules without evaluation order flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const lq005 = result.issues.filter((i) => i.check_id === 'LQ-005');
    expect(lq005.length).toBeGreaterThan(0);
    expect(lq005[0].severity).toBe('info');
    expect(lq005[0].category).toBe('lookup_queries');
  });

  it('Lookup queries score drops below 100 with problematic data', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    expect(result.category_scores.lookup_queries).toBeLessThan(100);
  });

  // ── Mixed: Only lookups broken, bundles unaffected ──
  it('Breaking only lookups does not affect bundles score', async () => {
    const data = createCleanData();
    // Add broken lookup rule
    data.priceRules.push({
      Id: 'pr_broken', Name: 'Broken Lookup', SBQQ__Active__c: true,
      SBQQ__EvaluationOrder__c: 50, SBQQ__TargetObject__c: 'Quote Line',
      SBQQ__LookupObject__c: 'Custom_Obj__c',
      SBQQ__PriceConditions__r: { records: [{ Id: 'pc_b', SBQQ__Field__c: 'SBQQ__Quantity__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '1', SBQQ__Object__c: 'Quote Line' }] },
      SBQQ__PriceActions__r: { records: [{ Id: 'pa_b', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '50', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
    });
    const result = await runAnalysis(data);
    expect(result.category_scores.lookup_queries).toBeLessThan(100);
    expect(result.category_scores.bundles).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 8: New Info/Critical/Warning Checks — Severity Coverage
// ═══════════════════════════════════════════════════════════════════
describe('SCENARIO: New Severity Coverage Checks', () => {
  it('QL-004: Excessive discounting flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ql004 = result.issues.filter((i) => i.check_id === 'QL-004');
    expect(ql004.length).toBeGreaterThan(0);
    expect(ql004[0].severity).toBe('info');
    expect(ql004[0].category).toBe('quote_lines');
  });

  it('PRD-005: Inactive product rules flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const prd005 = result.issues.filter((i) => i.check_id === 'PRD-005');
    expect(prd005.length).toBeGreaterThan(0);
    expect(prd005[0].severity).toBe('info');
  });

  it('SV-006: Inactive summary variables flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sv006 = result.issues.filter((i) => i.check_id === 'SV-006');
    expect(sv006.length).toBeGreaterThan(0);
    expect(sv006[0].severity).toBe('info');
  });

  it('AP-005: Multiple pricing methods flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ap005 = result.issues.filter((i) => i.check_id === 'AP-005');
    expect(ap005.length).toBeGreaterThan(0);
    expect(ap005[0].severity).toBe('info');
  });

  it('AR-005: Inactive approval rules flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ar005 = result.issues.filter((i) => i.check_id === 'AR-005');
    expect(ar005.length).toBeGreaterThan(0);
    expect(ar005[0].severity).toBe('info');
  });

  it('SR-003: Subscriptions without contract flagged as critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sr003 = result.issues.filter((i) => i.check_id === 'SR-003');
    expect(sr003.length).toBeGreaterThan(0);
    expect(sr003[0].severity).toBe('critical');
  });

  it('SR-004: High-quantity subscriptions flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const sr004 = result.issues.filter((i) => i.check_id === 'SR-004');
    expect(sr004.length).toBeGreaterThan(0);
    expect(sr004[0].severity).toBe('info');
  });

  it('CP-002: Contracted prices without dates flagged as critical', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const cp002 = result.issues.filter((i) => i.check_id === 'CP-002');
    expect(cp002.length).toBeGreaterThan(0);
    expect(cp002[0].severity).toBe('critical');
  });

  it('CP-003: Contracted prices without source quote line flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const cp003 = result.issues.filter((i) => i.check_id === 'CP-003');
    expect(cp003.length).toBeGreaterThan(0);
    expect(cp003[0].severity).toBe('info');
  });

  it('GS-004: Low output ratio flagged as warning', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const gs004 = result.issues.filter((i) => i.check_id === 'GS-004');
    expect(gs004.length).toBeGreaterThan(0);
    expect(gs004[0].severity).toBe('warning');
  });

  it('IA-006: High configuration complexity flagged as info', async () => {
    const data = createProblematicData();
    const result = await runAnalysis(data);
    const ia006 = result.issues.filter((i) => i.check_id === 'IA-006');
    expect(ia006.length).toBeGreaterThan(0);
    expect(ia006[0].severity).toBe('info');
  });

  it('QT-005: Default template not active flagged as critical (via custom data)', async () => {
    const data = createCleanData();
    data.quoteTemplates = [
      { Id: 'qt_default_draft', Name: 'Default Draft', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Draft', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Header', SBQQ__Content__c: 'h' }] } },
    ];
    const result = await runAnalysis(data);
    const qt005 = result.issues.filter((i) => i.check_id === 'QT-005');
    expect(qt005.length).toBeGreaterThan(0);
    expect(qt005[0].severity).toBe('critical');
  });
});
