import { describe, it, expect } from 'vitest';
import { impactAnalysisChecks } from '@/lib/analysis/checks/impact-analysis';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => impactAnalysisChecks.find((c) => c.id === id)!;

describe('Impact Analysis — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // IA-001: Price Rule Dependency Chains
  // Builds map of fields each rule writes (PriceActions). Checks if any
  // rule's PriceConditions read from fields another rule writes.
  // Flags if chains found. critical if >= 5 chains.
  // ═══════════════════════════════════════════════
  describe('IA-001: Price Rule Dependency Chains', () => {
    const check = getCheck('IA-001');

    // ── Negative tests ──
    it('should pass with clean fixture data (rules read/write disjoint fields)', async () => {
      const data = createCleanData();
      // Clean data: pr1 reads SBQQ__ProductCode__c, writes SBQQ__Discount__c
      //             pr2 reads SBQQ__Quantity__c, writes SBQQ__UnitPrice__c
      // No rule reads a field that another writes => no chain
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with a single active rule (no chain possible)', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Solo', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [{ Id: 'pc1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '0', SBQQ__Object__c: 'Quote Line' }] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should detect a simple two-rule dependency chain', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Discount Writer', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '15', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
        {
          Id: 'pr2', Name: 'Discount Reader', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 20,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'greater than', SBQQ__Value__c: '10', SBQQ__Object__c: 'Quote Line' }] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa2', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('IA-001');
      expect(issues[0].severity).toBe('warning');
    });

    it('should flag critical when 5+ dependency chains exist', async () => {
      const data = createCleanData();
      // 6 rules: rule i writes Custom_Field_i__c, rule i+1 reads Custom_Field_i__c => 5 chains
      data.priceRules = Array.from({ length: 6 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Chain Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: (i + 1) * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: {
          records: i > 0
            ? [{ Id: `pc_${i}`, SBQQ__Field__c: `Custom_Field_${i - 1}__c`, SBQQ__Operator__c: 'equals', SBQQ__Value__c: 'X', SBQQ__Object__c: 'Quote Line' }]
            : [],
        },
        SBQQ__PriceActions__r: {
          records: [{ Id: `pa_${i}`, SBQQ__Field__c: `Custom_Field_${i}__c`, SBQQ__Value__c: 'Y', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }],
        },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should ignore inactive rules even if they form chains', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Writer', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
        {
          Id: 'pr2', Name: 'Reader', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 20,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [{ Id: 'pc2', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Operator__c: 'equals', SBQQ__Value__c: '10', SBQQ__Object__c: 'Quote Line' }] },
          SBQQ__PriceActions__r: { records: [] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // IA-002: Overlapping Rule Scope
  // Groups rules by target field (from PriceActions).
  // Flags if 4+ rules target same field. critical if >= 6.
  // ═══════════════════════════════════════════════
  describe('IA-002: Overlapping Rule Scope', () => {
    const check = getCheck('IA-002');

    // ── Negative tests ──
    it('should pass with clean fixture data (2 rules targeting different fields)', async () => {
      const data = createCleanData();
      // pr1 writes SBQQ__Discount__c, pr2 writes SBQQ__UnitPrice__c => 1 each, no overlap
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 3 rules targeting the same field (below threshold of 4)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 3 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] },
        SBQQ__PriceActions__r: { records: [{ Id: `pa_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty price rules', async () => {
      const data = createCleanData();
      data.priceRules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag warning when exactly 4 rules target the same field (boundary)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 4 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] },
        SBQQ__PriceActions__r: { records: [{ Id: `pa_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('IA-002');
      expect(issues[0].title).toContain('SBQQ__Discount__c');
    });

    it('should flag critical when 6+ rules target the same field (boundary)', async () => {
      const data = createCleanData();
      data.priceRules = Array.from({ length: 6 }, (_, i) => ({
        Id: `pr_${i}`, Name: `Rule ${i}`, SBQQ__Active__c: true,
        SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
        SBQQ__PriceConditions__r: { records: [] },
        SBQQ__PriceActions__r: { records: [{ Id: `pa_${i}`, SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should flag multiple fields independently when each has 4+ rules', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...Array.from({ length: 4 }, (_, i) => ({
          Id: `pr_d_${i}`, Name: `Discount Rule ${i}`, SBQQ__Active__c: true,
          SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: `pa_d_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          Id: `pr_p_${i}`, Name: `Price Rule ${i}`, SBQQ__Active__c: true,
          SBQQ__EvaluationOrder__c: (i + 10) * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: `pa_p_${i}`, SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '200', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        })),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });

    it('should only count active rules toward overlapping scope', async () => {
      const data = createCleanData();
      data.priceRules = [
        ...Array.from({ length: 3 }, (_, i) => ({
          Id: `pr_a_${i}`, Name: `Active ${i}`, SBQQ__Active__c: true,
          SBQQ__EvaluationOrder__c: i * 10, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: `pa_a_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          Id: `pr_i_${i}`, Name: `Inactive ${i}`, SBQQ__Active__c: false,
          SBQQ__EvaluationOrder__c: null, SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: `pa_i_${i}`, SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        })),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // IA-003: Discount Schedule + Price Rule Overlap
  // Flags if discountSchedules exist AND active price rules target
  // SBQQ__Discount__c, SBQQ__UnitPrice__c, or SBQQ__NetPrice__c.
  // NOTE: Clean fixture WILL trigger this because ds1 exists and pr1
  // writes SBQQ__Discount__c.
  // ═══════════════════════════════════════════════
  describe('IA-003: Discount Schedule and Price Rule Overlap', () => {
    const check = getCheck('IA-003');

    // ── Negative tests ──
    it('should pass when no discount schedules exist', async () => {
      const data = createCleanData();
      data.discountSchedules = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when price rules do not target discount-related fields', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Custom Field Rule', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'Custom_Field__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when discount schedules exist but all price rules are inactive', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Inactive Conflict', SBQQ__Active__c: false, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__Discount__c', SBQQ__Value__c: '10', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag on clean fixture data (ds1 exists, pr1 writes SBQQ__Discount__c)', async () => {
      const data = createCleanData();
      // Clean data has 1 discount schedule and pr1 writes SBQQ__Discount__c => overlap
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('IA-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('SBQQ__Discount__c');
    });

    it('should flag when active rules target SBQQ__UnitPrice__c alongside discount schedules', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Unit Price Setter', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__UnitPrice__c', SBQQ__Value__c: '100', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('SBQQ__UnitPrice__c');
    });

    it('should flag when active rules target SBQQ__NetPrice__c alongside discount schedules', async () => {
      const data = createCleanData();
      data.priceRules = [
        {
          Id: 'pr1', Name: 'Net Price Setter', SBQQ__Active__c: true, SBQQ__EvaluationOrder__c: 10,
          SBQQ__TargetObject__c: 'Quote Line', SBQQ__LookupObject__c: null,
          SBQQ__PriceConditions__r: { records: [] },
          SBQQ__PriceActions__r: { records: [{ Id: 'pa1', SBQQ__Field__c: 'SBQQ__NetPrice__c', SBQQ__Value__c: '500', SBQQ__Formula__c: null, SBQQ__SourceLookupField__c: null }] },
        },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('SBQQ__NetPrice__c');
    });
  });

  // ═══════════════════════════════════════════════
  // IA-004: Orphaned Configuration References
  // Checks contractedPrices linked to inactive products
  // (product Id not in active product Ids). Flags if found.
  // ═══════════════════════════════════════════════
  describe('IA-004: Orphaned Configuration References', () => {
    const check = getCheck('IA-004');

    // ── Negative tests ──
    it('should pass with clean fixture data (cp1 references active product p1)', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with no contracted prices', async () => {
      const data = createCleanData();
      data.contractedPrices = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when contracted price has null Product__c', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'No Product', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme' }, SBQQ__Product__c: null as unknown as string, SBQQ__Product__r: { Name: 'N/A', IsActive: false }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag contracted prices linked to inactive products', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Active Prod', ProductCode: 'AP-1', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
        { Id: 'p2', Name: 'Inactive Prod', ProductCode: 'IP-1', IsActive: false, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.contractedPrices = [
        { Id: 'cp1', Name: 'Orphaned CP', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme' }, SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Inactive Prod', IsActive: false }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('IA-004');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('cp1');
    });

    it('should flag contracted prices linked to products not in the dataset', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'Missing Product CP', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme' }, SBQQ__Product__c: 'p_nonexistent', SBQQ__Product__r: { Name: 'Deleted Prod', IsActive: false }, SBQQ__Price__c: 50, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
    });

    it('should report multiple orphaned contracted prices and cap affected_records at 10', async () => {
      const data = createCleanData();
      data.products = [
        { Id: 'p1', Name: 'Active Prod', ProductCode: 'AP-1', IsActive: true, SBQQ__SubscriptionType__c: null, SBQQ__SubscriptionPricing__c: null, SBQQ__ChargeType__c: 'One-Time', SBQQ__BillingFrequency__c: null, SBQQ__PricingMethod__c: 'List' },
      ];
      data.contractedPrices = Array.from({ length: 12 }, (_, i) => ({
        Id: `cp_${i}`, Name: `Orphan ${i}`, SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme' },
        SBQQ__Product__c: `p_dead_${i}`, SBQQ__Product__r: { Name: `Dead ${i}`, IsActive: false },
        SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2027-12-31', SBQQ__OriginalQuoteLine__c: null,
      }));
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toContain('12');
      expect(issues[0].affected_records.length).toBeLessThanOrEqual(10);
    });
  });
});
