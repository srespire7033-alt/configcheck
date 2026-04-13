import { describe, it, expect } from 'vitest';
import { performanceChecks } from '@/lib/analysis/checks/performance';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => performanceChecks.find((c) => c.id === id)!;

describe('Performance — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // PERF-001: High Price Rule Count
  // Flags if activeRules.length >= 50 (warning), >= 100 (critical)
  // ═══════════════════════════════════════════════
  describe('PERF-001: High Price Rule Count', () => {
    const check = getCheck('PERF-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean fixture data (2 active price rules)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 49 active price rules (just below threshold)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 49 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when many rules exist but are all inactive', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 150 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: false,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag warning at exactly 50 active price rules (boundary)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 50 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('PERF-001');
      expect(issues[0].title).toContain('50');
    });

    it('should flag critical at exactly 100 active price rules (boundary)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 100 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should only count active rules — mix of 55 active and 200 inactive', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...Array.from({ length: 55 }, (_, i) => ({
          Id: `pr_a_${i}`, Name: `Active ${i}`, SBQQ__Active__c: true,
          SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
        ...Array.from({ length: 200 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
        })),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('55');
    });
  });

  // ═══════════════════════════════════════════════
  // PERF-002: High Product Rule Count
  // Flags if activeRules.length >= 30 (warning), >= 60 (critical)
  // ═══════════════════════════════════════════════
  describe('PERF-002: High Product Rule Count', () => {
    const check = getCheck('PERF-002');

    // ── Negative tests ──
    it('should pass with clean fixture data (1 active product rule)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 29 active product rules (just below threshold)', async () => {
      const data = createCleanData();
      data.productRules = Array.from({ length: 29 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when 60 product rules exist but all inactive', async () => {
      const data = createCleanData();
      data.productRules = Array.from({ length: 60 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: false, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag warning at exactly 30 active product rules (boundary)', async () => {
      const data = createCleanData();
      data.productRules = Array.from({ length: 30 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('PERF-002');
    });

    it('should flag critical at exactly 60 active product rules (boundary)', async () => {
      const data = createCleanData();
      data.productRules = Array.from({ length: 60 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should cap affected_records at 10 even with many rules', async () => {
      const data = createCleanData();
      data.productRules = Array.from({ length: 40 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records.length).toBeLessThanOrEqual(10);
    });
  });

  // ═══════════════════════════════════════════════
  // PERF-003: Quote Line Volume
  // Flags if maxLines > 100 || avgLines > 50 (warning), maxLines > 200 (critical)
  // ═══════════════════════════════════════════════
  describe('PERF-003: Quote Line Volume', () => {
    const check = getCheck('PERF-003');

    // ── Negative tests ──
    it('should pass with clean fixture data (3 lines across 2 quotes)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with no quote lines', async () => {
      const data = createCleanData();
      data.quoteLines = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with no quotes', async () => {
      const data = createCleanData();
      data.quotes = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag warning when max lines exceed 100', async () => {
      const data = createCleanData();
      data.quoteLines = [
        ...Array.from({ length: 101 }, (_, i) => ({
          Id: `ql_a_${i}`, SBQQ__Quote__c: 'q1',
          SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
          SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
          SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
          SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          Id: `ql_b_${i}`, SBQQ__Quote__c: 'q2',
          SBQQ__Product__r: { Name: `Prod B ${i}` }, SBQQ__Quantity__c: 1,
          SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
          SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
          SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
          SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
        })),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('PERF-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('101');
    });

    it('should flag warning when average lines exceed 50 even if max is under 100', async () => {
      const data = createCleanData();
      // 2 quotes, 55 lines each => avg=55, max=55 (max under 100 but avg over 50)
      data.quoteLines = Array.from({ length: 110 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: i < 55 ? 'q1' : 'q2',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
    });

    it('should flag critical when max lines exceed 200', async () => {
      const data = createCleanData();
      data.quoteLines = Array.from({ length: 201 }, (_, i) => ({
        Id: `ql_${i}`, SBQQ__Quote__c: 'q1',
        SBQQ__Product__r: { Name: `Prod ${i}` }, SBQQ__Quantity__c: 1,
        SBQQ__NetPrice__c: 100, SBQQ__NetTotal__c: 100, SBQQ__ListPrice__c: 100,
        SBQQ__ProrateMultiplier__c: null, SBQQ__SubscriptionPricing__c: null,
        SBQQ__ChargeType__c: null, SBQQ__Discount__c: null, SBQQ__AdditionalDiscount__c: null,
        SBQQ__UpliftAmount__c: null, SBQQ__Uplift__c: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });
  });

  // ═══════════════════════════════════════════════
  // PERF-004: Summary Variable Overhead
  // Flags if activeVars.length >= 20 (info), >= 40 (warning)
  // ═══════════════════════════════════════════════
  describe('PERF-004: Summary Variable Overhead', () => {
    const check = getCheck('PERF-004');

    // ── Negative tests ──
    it('should pass with clean fixture data (1 active summary variable)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 19 active summary variables (just below threshold)', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 19 }, (_, i) => ({
        Id: `sv_${i}`, Name: `Var ${i}`, SBQQ__Active__c: true,
        SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
        SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
        SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
        SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
        referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when 40 summary variables exist but are all inactive', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 40 }, (_, i) => ({
        Id: `sv_${i}`, Name: `Var ${i}`, SBQQ__Active__c: false,
        SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
        SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
        SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
        SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
        referencedByPriceRuleCount: 0, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag info at exactly 20 active summary variables (boundary)', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 20 }, (_, i) => ({
        Id: `sv_${i}`, Name: `Var ${i}`, SBQQ__Active__c: true,
        SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
        SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
        SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
        SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
        referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].check_id).toBe('PERF-004');
    });

    it('should flag warning at exactly 40 active summary variables (boundary)', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 40 }, (_, i) => ({
        Id: `sv_${i}`, Name: `Var ${i}`, SBQQ__Active__c: true,
        SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
        SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
        SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
        SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
        referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
    });

    it('should cap affected_records at 10 even with many variables', async () => {
      const data = createCleanData();
      data.summaryVariables = Array.from({ length: 50 }, (_, i) => ({
        Id: `sv_${i}`, Name: `Var ${i}`, SBQQ__Active__c: true,
        SBQQ__AggregateField__c: 'SBQQ__Quantity__c', SBQQ__AggregateFunction__c: 'Sum',
        SBQQ__TargetObject__c: 'Quote Line', SBQQ__Scope__c: 'Quote',
        SBQQ__FilterField__c: null, SBQQ__FilterValue__c: null, SBQQ__Operator__c: null,
        SBQQ__CombineWith__c: null, SBQQ__SecondOperand__c: null, SBQQ__CompositeOperator__c: null,
        referencedByPriceRuleCount: 1, referencedByProductRuleCount: 0,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records.length).toBeLessThanOrEqual(10);
    });
  });

  // ═══════════════════════════════════════════════
  // PERF-005: CPQ Complexity Score
  // Weighted: activePR*3 + activePRD*2 + activeSV*1.5 + DS*1 + options*0.5 + (QCP?20:0)
  // No issue if < 50, info if >= 50, warning if >= 100, critical if >= 200
  // Clean fixture: 2*3 + 1*2 + 1*1.5 + 1*1 + 1*0.5 + 20 = 31 (below 50)
  // ═══════════════════════════════════════════════
  describe('PERF-005: CPQ Complexity Score', () => {
    const check = getCheck('PERF-005');

    // ── Negative tests ──
    it('should return empty with clean fixture data (complexity 31, below 50)', async () => {
      const data = createCleanData();
      // 2*3 + 1*2 + 1*1.5 + 1*1 + 1*0.5 + 20 = 31
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should return empty with all arrays empty (complexity 0)', async () => {
      const data = createCleanData();
      data.priceRules = [];
      data.productRules = [];
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.products = [];
      data.productOptions = [];
      data.customScripts = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should return empty at complexity score 49 (just below threshold)', async () => {
      const data = createCleanData();
      // Target 49: 16 PR * 3 = 48, plus 1 DS = 49, no QCP, no others
      data.priceRules = Array.from({ length: 16 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = [];
      data.summaryVariables = [];
      data.discountSchedules = [
        { Id: 'ds1', Name: 'DS', SBQQ__Type__c: 'Range', SBQQ__DiscountUnit__c: 'Percent', SBQQ__DiscountTiers__r: { records: [] } },
      ];
      data.productOptions = [];
      data.customScripts = [];
      // 16*3 + 1 = 49
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag info when complexity is exactly 50 (boundary)', async () => {
      const data = createCleanData();
      // 10 PR * 3 = 30, QCP = 20 => 50
      data.priceRules = Array.from({ length: 10 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = [];
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.productOptions = [];
      // customScripts already has 1 entry => QCP = 20
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].title).toContain('Moderate');
    });

    it('should flag warning when complexity is exactly 100 (boundary)', async () => {
      const data = createCleanData();
      // 20 PR * 3 = 60, 10 PRD * 2 = 20, QCP = 20 => 100
      data.priceRules = Array.from({ length: 20 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = Array.from({ length: 10 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.productOptions = [];
      // 20*3 + 10*2 + 20 = 100 => warning
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('High');
    });

    it('should flag critical when complexity is exactly 200 (boundary)', async () => {
      const data = createCleanData();
      // 50 PR * 3 = 150, 15 PRD * 2 = 30, QCP = 20 => 200
      data.priceRules = Array.from({ length: 50 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = Array.from({ length: 15 }, (_, i) => ({
        Id: `prd_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true, SBQQ__Type__c: 'Validation',
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__ConditionsMet__c: 'All',
        SBQQ__ErrorConditions__r: { records: [] }, SBQQ__Actions__r: { records: [] },
      }));
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.productOptions = [];
      // 50*3 + 15*2 + 20 = 200 => critical
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('Very High');
    });

    it('should include QCP weight of 20 — removing QCP drops below threshold', async () => {
      const data = createCleanData();
      // With QCP: 10*3 + 20 = 50 (info). Without QCP: 10*3 = 30 (no issue)
      data.priceRules = Array.from({ length: 10 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = [];
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.productOptions = [];

      // With QCP
      const issuesWithQCP = await check.run(data);
      expect(issuesWithQCP).toHaveLength(1);

      // Without QCP
      data.customScripts = [];
      const issuesWithoutQCP = await check.run(data);
      expect(issuesWithoutQCP).toHaveLength(0);
    });

    it('should factor in productOptions and discountSchedules', async () => {
      const data = createCleanData();
      // 10 PR * 3 = 30, 40 options * 0.5 = 20 => 50 = info
      data.priceRules = Array.from({ length: 10 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] }, SBQQ__PriceActions__r: { records: [] },
      }));
      data.productRules = [];
      data.summaryVariables = [];
      data.discountSchedules = [];
      data.customScripts = [];
      data.productOptions = Array.from({ length: 40 }, (_, i) => ({
        Id: `po_${i}`, Name: `Option ${i}`,
        SBQQ__ConfiguredSKU__c: 'p1', SBQQ__OptionalSKU__c: 'p2',
        SBQQ__ConfiguredSKU__r: { Name: 'Product A', IsActive: true },
        SBQQ__OptionalSKU__r: { Name: 'Product B', IsActive: true },
      }));
      // 10*3 + 40*0.5 = 50 => info
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
    });
  });
});
