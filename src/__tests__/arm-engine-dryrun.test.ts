import { describe, it, expect } from 'vitest';
import { armChecks } from '@/lib/analysis/arm-checks';
import { runARMAnalysis } from '@/lib/analysis/arm-engine';
import type { ARMData } from '@/types';

const emptyARMData = (): ARMData => ({
  products: [],
  sellingModels: [],
  sellingModelOptions: [],
  priceAdjustmentSchedules: [],
  priceAdjustmentTiers: [],
  attributeBasedAdjRules: [],
  productRelatedComponents: [],
  priceBooks: [],
  productCategories: [],
  productCategoryProducts: [],
  pricingProcedures: [],
  decisionTables: [],
  contextDefinitions: [],
  rateCards: [],
  rateCardEntries: [],
  attributeDefinitions: [],
  attributeCategories: [],
  attributePicklistValues: [],
  assets: [],
  assetStatePeriods: [],
  assetRelationships: [],
  contracts: [],
  contractItemPrices: [],
  unitOfMeasureClasses: [],
  usageResources: [],
  productUsageGrants: [],
  fulfillmentStepDefinitions: [],
  fulfillmentStepDefinitionGroups: [],
  productFulfillmentScenarios: [],
  fulfillmentTaskAssignmentRules: [],
  costBooks: [],
  costBookEntries: [],
});

describe('ARM engine — dry run smoke tests', () => {
  it('registers a non-trivial number of checks across multiple categories', () => {
    expect(armChecks.length).toBeGreaterThanOrEqual(50);
    const categories = new Set(armChecks.map((c) => c.category));
    expect(categories.size).toBeGreaterThanOrEqual(11);
  });

  it('runs cleanly on a totally empty org and returns no issues', async () => {
    const result = await runARMAnalysis(emptyARMData());
    expect(result.issues).toEqual([]);
    expect(result.overall_score).toBe(100);
    expect(Object.values(result.category_scores).every((s) => s === 100)).toBe(true);
  });

  it('every check id is unique', () => {
    const ids = armChecks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every check declares a recognised severity', () => {
    for (const c of armChecks) {
      expect(['critical', 'warning', 'info']).toContain(c.severity);
    }
  });

  it('every check declares an arm_* category', () => {
    for (const c of armChecks) {
      expect(c.category.startsWith('arm_')).toBe(true);
    }
  });

  it('detects the overlapping-tier scenario (ARM-003)', async () => {
    const data = emptyARMData();
    data.priceAdjustmentSchedules = [
      { Id: 'pas1', Name: 'Volume Discount', IsActive: true },
    ];
    data.priceAdjustmentTiers = [
      { Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 },
      // Overlap — next tier starts before t1 ends
      { Id: 't2', PriceAdjustmentScheduleId: 'pas1', LowerBound: 50, UpperBound: 200 },
    ];
    const result = await runARMAnalysis(data);
    const arm003 = result.issues.find((i) => i.check_id === 'ARM-003');
    expect(arm003).toBeDefined();
  });

  it('detects bundle min > max (ARM-013)', async () => {
    const data = emptyARMData();
    data.products = [
      { Id: 'p1', Name: 'Bundle', IsActive: true },
      { Id: 'p2', Name: 'Component', IsActive: true },
    ];
    data.productRelatedComponents = [
      { Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2', MinQuantity: 5, MaxQuantity: 2 },
    ];
    const result = await runARMAnalysis(data);
    const arm013 = result.issues.find((i) => i.check_id === 'ARM-013');
    expect(arm013).toBeDefined();
    expect(arm013!.severity).toBe('critical');
  });

  it('detects multiple-current AssetStatePeriods (ARM-034)', async () => {
    const data = emptyARMData();
    data.assets = [{ Id: 'a1', Name: 'Server-X', Status: 'Active' }];
    data.assetStatePeriods = [
      { Id: 'p1', AssetId: 'a1', IsCurrent: true, Quantity: 10 },
      { Id: 'p2', AssetId: 'a1', IsCurrent: true, Quantity: 5 },
    ];
    const result = await runARMAnalysis(data);
    const arm034 = result.issues.find((i) => i.check_id === 'ARM-034');
    expect(arm034).toBeDefined();
    expect(arm034!.severity).toBe('critical');
  });

  it('detects contract with reversed dates (ARM-039)', async () => {
    const data = emptyARMData();
    data.contracts = [
      { Id: 'c1', Status: 'Activated', StartDate: '2026-12-01', EndDate: '2026-01-01' },
    ];
    const result = await runARMAnalysis(data);
    const arm039 = result.issues.find((i) => i.check_id === 'ARM-039');
    expect(arm039).toBeDefined();
    expect(arm039!.severity).toBe('critical');
  });

  it('detects empty fulfillment step group (ARM-046)', async () => {
    const data = emptyARMData();
    data.fulfillmentStepDefinitionGroups = [
      { Id: 'g1', Name: 'Empty Group', Status: 'Active' },
    ];
    const result = await runARMAnalysis(data);
    const arm046 = result.issues.find((i) => i.check_id === 'ARM-046');
    expect(arm046).toBeDefined();
  });

  it('detects active cost book with no entries (ARM-049)', async () => {
    const data = emptyARMData();
    data.costBooks = [
      { Id: 'cb1', Name: 'Standard Costs', IsActive: true, IsStandard: false },
    ];
    const result = await runARMAnalysis(data);
    const arm049 = result.issues.find((i) => i.check_id === 'ARM-049');
    expect(arm049).toBeDefined();
  });

  it('respects suppressedCheckIds (Tier 1 feedback loop)', async () => {
    const data = emptyARMData();
    data.priceAdjustmentSchedules = [{ Id: 'pas1', Name: 'X', IsActive: true }];
    data.priceAdjustmentTiers = [
      { Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 },
      { Id: 't2', PriceAdjustmentScheduleId: 'pas1', LowerBound: 50, UpperBound: 200 },
    ];
    const result = await runARMAnalysis(data, ['ARM-003']);
    const arm003 = result.issues.find((i) => i.check_id === 'ARM-003');
    expect(arm003).toBeUndefined();
  });

  it('all weights sum to 1.0 (engine score normalisation)', async () => {
    // Indirect check: when ALL categories are at 100, overall score should be 100
    const result = await runARMAnalysis(emptyARMData());
    expect(result.overall_score).toBe(100);
  });
});
