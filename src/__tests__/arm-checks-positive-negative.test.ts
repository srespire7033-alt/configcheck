/**
 * Positive + negative simulation tests for every ARM check.
 *
 * For each check we run two scenarios:
 *   - "negative": craft data that should TRIGGER the issue, assert the check fires
 *   - "positive": craft data that should NOT trigger the issue, assert the check is silent
 *
 * This gives us high confidence that the checks behave correctly when the
 * Ksolves-Sanjeev (or any ARM org) is scanned for real.
 */
import { describe, it, expect } from 'vitest';
import { armChecks } from '@/lib/analysis/arm-checks';
import type { ARMData } from '@/types';

const empty = (): ARMData => ({
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

const getCheck = (id: string) => armChecks.find((c) => c.id === id)!;

const todayPlus = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('ARM check simulation — positive (clean) + negative (broken) scenarios', () => {
  // ─── ARM-001 Active product without selling model ────────────────
  describe('ARM-001 Active product without selling model', () => {
    const c = getCheck('ARM-001');
    it('FIRES on active product with no option', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Widget', IsActive: true }];
      const r = await c.run(d);
      expect(r).toHaveLength(1);
    });
    it('PASSES when product has active selling model option', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Widget', IsActive: true }];
      d.sellingModels = [{ Id: 'sm1', Name: 'Annual', IsActive: true, SellingModelType: 'TermDefined', PricingTerm: 12 }];
      d.sellingModelOptions = [{ Id: 'smo1', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true }];
      const r = await c.run(d);
      expect(r).toHaveLength(0);
    });
  });

  // ─── ARM-002 Recurring selling model without billing frequency ───
  describe('ARM-002 Recurring selling model without billing frequency', () => {
    const c = getCheck('ARM-002');
    it('FIRES on TermDefined model without SellingFrequencyId', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Annual', IsActive: true, SellingModelType: 'TermDefined' }];
      const r = await c.run(d);
      expect(r).toHaveLength(1);
    });
    it('PASSES on OneTime model (frequency irrelevant)', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'OneShot', IsActive: true, SellingModelType: 'OneTime' }];
      const r = await c.run(d);
      expect(r).toHaveLength(0);
    });
    it('PASSES on TermDefined with SellingFrequencyId set', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Annual', IsActive: true, SellingModelType: 'TermDefined', SellingFrequencyId: 'sf1' }];
      const r = await c.run(d);
      expect(r).toHaveLength(0);
    });
  });

  // ─── ARM-003 Overlapping price adjustment tiers ─────────────────
  describe('ARM-003 Overlapping price adjustment tiers', () => {
    const c = getCheck('ARM-003');
    it('FIRES when tiers overlap', async () => {
      const d = empty();
      d.priceAdjustmentSchedules = [{ Id: 'pas1', Name: 'Volume', IsActive: true }];
      d.priceAdjustmentTiers = [
        { Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 },
        { Id: 't2', PriceAdjustmentScheduleId: 'pas1', LowerBound: 50, UpperBound: 200 },
      ];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on contiguous, non-overlapping tiers', async () => {
      const d = empty();
      d.priceAdjustmentSchedules = [{ Id: 'pas1', Name: 'Volume', IsActive: true }];
      d.priceAdjustmentTiers = [
        { Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 },
        { Id: 't2', PriceAdjustmentScheduleId: 'pas1', LowerBound: 100, UpperBound: 200 },
      ];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-004 Attribute rule without effective dates ──────────────
  describe('ARM-004 Attribute rule without effective dates', () => {
    const c = getCheck('ARM-004');
    it('FIRES on undated active rule', async () => {
      const d = empty();
      d.attributeBasedAdjRules = [{ Id: 'r1', Name: 'Promo', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with EffectiveStartDate set', async () => {
      const d = empty();
      d.attributeBasedAdjRules = [{ Id: 'r1', Name: 'Promo', IsActive: true, EffectiveStartDate: '2026-01-01' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-005 Empty bundle (no related components) ────────────────
  describe('ARM-005 Empty bundle', () => {
    const c = getCheck('ARM-005');
    it('FIRES on bundle-named product with no components', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Server Bundle', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when bundle has components', async () => {
      const d = empty();
      d.products = [
        { Id: 'p1', Name: 'Server Bundle', IsActive: true },
        { Id: 'p2', Name: 'CPU', IsActive: true },
      ];
      d.productRelatedComponents = [{ Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-006 Pricing procedure without resolution policy ─────────
  describe('ARM-006 Pricing procedure without resolution policy', () => {
    const c = getCheck('ARM-006');
    it('FIRES on active procedure with null ResolutionPolicy', async () => {
      const d = empty();
      d.pricingProcedures = [{ Id: 'pp1', Name: 'Default', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with resolution policy set', async () => {
      const d = empty();
      d.pricingProcedures = [{ Id: 'pp1', Name: 'Default', IsActive: true, ResolutionPolicy: 'HighestPriority' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-007 Multiple active price books per currency ────────────
  describe('ARM-007 Multiple active price books per currency', () => {
    const c = getCheck('ARM-007');
    it('FIRES when 2 non-standard pricebooks share a currency', async () => {
      const d = empty();
      d.priceBooks = [
        { Id: 'pb1', Name: 'US Standard', IsActive: true, IsStandard: false, CurrencyIsoCode: 'USD' },
        { Id: 'pb2', Name: 'US Channel', IsActive: true, IsStandard: false, CurrencyIsoCode: 'USD' },
      ];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with single non-standard pricebook per currency', async () => {
      const d = empty();
      d.priceBooks = [
        { Id: 'pb1', Name: 'US', IsActive: true, IsStandard: false, CurrencyIsoCode: 'USD' },
        { Id: 'pb2', Name: 'EU', IsActive: true, IsStandard: false, CurrencyIsoCode: 'EUR' },
      ];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-008 Decision tables not Active ──────────────────────────
  describe('ARM-008 Inactive/draft decision tables', () => {
    const c = getCheck('ARM-008');
    it('FIRES on draft decision table', async () => {
      const d = empty();
      d.decisionTables = [{ Id: 'dt1', MasterLabel: 'Pricing', Status: 'Draft' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on all-Active', async () => {
      const d = empty();
      d.decisionTables = [{ Id: 'dt1', MasterLabel: 'Pricing', Status: 'Active' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-009 Inactive context definitions ────────────────────────
  describe('ARM-009 Inactive context definitions', () => {
    const c = getCheck('ARM-009');
    it('FIRES on inactive definition', async () => {
      const d = empty();
      d.contextDefinitions = [{ Id: 'cd1', DeveloperName: 'CustomerCtx', IsActive: false }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on all active', async () => {
      const d = empty();
      d.contextDefinitions = [{ Id: 'cd1', DeveloperName: 'CustomerCtx', IsActive: true }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-010 Inactive category with active products ──────────────
  describe('ARM-010 Inactive category with active products', () => {
    const c = getCheck('ARM-010');
    it('FIRES when active product is in inactive category', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Active Product', IsActive: true }];
      d.productCategories = [{ Id: 'cat1', Name: 'Old', IsActive: false }];
      d.productCategoryProducts = [{ Id: 'pcp1', ProductId: 'p1', ProductCategoryId: 'cat1' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when category is active', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Active Product', IsActive: true }];
      d.productCategories = [{ Id: 'cat1', Name: 'New', IsActive: true }];
      d.productCategoryProducts = [{ Id: 'pcp1', ProductId: 'p1', ProductCategoryId: 'cat1' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-011 Term selling model without pricing term ─────────────
  describe('ARM-011 Term selling model without pricing term', () => {
    const c = getCheck('ARM-011');
    it('FIRES on TermDefined with null term', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Annual', IsActive: true, SellingModelType: 'TermDefined' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with PricingTerm set', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Annual', IsActive: true, SellingModelType: 'TermDefined', PricingTerm: 12 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-012 Active option referencing inactive selling model ────
  describe('ARM-012 Active option on inactive model', () => {
    const c = getCheck('ARM-012');
    it('FIRES when option is active but model is inactive', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Old', IsActive: false, SellingModelType: 'TermDefined' }];
      d.sellingModelOptions = [{ Id: 'smo1', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when both active', async () => {
      const d = empty();
      d.sellingModels = [{ Id: 'sm1', Name: 'Current', IsActive: true, SellingModelType: 'TermDefined' }];
      d.sellingModelOptions = [{ Id: 'smo1', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-013 Bundle component min > max ──────────────────────────
  describe('ARM-013 Bundle component impossible quantity range', () => {
    const c = getCheck('ARM-013');
    it('FIRES when MinQuantity > MaxQuantity', async () => {
      const d = empty();
      d.productRelatedComponents = [
        { Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2', MinQuantity: 5, MaxQuantity: 2 },
      ];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on Min ≤ Max', async () => {
      const d = empty();
      d.productRelatedComponents = [
        { Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2', MinQuantity: 1, MaxQuantity: 5 },
      ];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-014 Component points to inactive child ──────────────────
  describe('ARM-014 Component points to inactive child product', () => {
    const c = getCheck('ARM-014');
    it('FIRES when child is inactive', async () => {
      const d = empty();
      d.products = [
        { Id: 'p1', Name: 'Bundle', IsActive: true },
        { Id: 'p2', Name: 'Old Component', IsActive: false },
      ];
      d.productRelatedComponents = [{ Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when child is active', async () => {
      const d = empty();
      d.products = [
        { Id: 'p1', Name: 'Bundle', IsActive: true },
        { Id: 'p2', Name: 'Component', IsActive: true },
      ];
      d.productRelatedComponents = [{ Id: 'prc1', ParentProductId: 'p1', ChildProductId: 'p2' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-016 Active price adjustment schedule with no tiers ──────
  describe('ARM-016 Active schedule with no tiers', () => {
    const c = getCheck('ARM-016');
    it('FIRES when schedule has no tiers', async () => {
      const d = empty();
      d.priceAdjustmentSchedules = [{ Id: 'pas1', Name: 'Empty', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when schedule has tiers', async () => {
      const d = empty();
      d.priceAdjustmentSchedules = [{ Id: 'pas1', Name: 'Volume', IsActive: true }];
      d.priceAdjustmentTiers = [{ Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-017 Tier with reversed bounds ───────────────────────────
  describe('ARM-017 Tier with reversed bounds', () => {
    const c = getCheck('ARM-017');
    it('FIRES on Lower > Upper', async () => {
      const d = empty();
      d.priceAdjustmentTiers = [{ Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 200, UpperBound: 100 }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on Lower ≤ Upper', async () => {
      const d = empty();
      d.priceAdjustmentTiers = [{ Id: 't1', PriceAdjustmentScheduleId: 'pas1', LowerBound: 0, UpperBound: 100 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-018 Active product without category ─────────────────────
  describe('ARM-018 Active product without category', () => {
    const c = getCheck('ARM-018');
    it('FIRES when no category assignment', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Lonely', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when product is in a category', async () => {
      const d = empty();
      d.products = [{ Id: 'p1', Name: 'Sociable', IsActive: true }];
      d.productCategoryProducts = [{ Id: 'pcp1', ProductId: 'p1', ProductCategoryId: 'cat1' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-019 Duplicate selling model options ─────────────────────
  describe('ARM-019 Duplicate selling model options', () => {
    const c = getCheck('ARM-019');
    it('FIRES on duplicate active options for same Product+Model', async () => {
      const d = empty();
      d.sellingModelOptions = [
        { Id: 'smo1', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true },
        { Id: 'smo2', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true },
      ];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on unique pairs', async () => {
      const d = empty();
      d.sellingModelOptions = [
        { Id: 'smo1', Product2Id: 'p1', ProductSellingModelId: 'sm1', IsActive: true },
        { Id: 'smo2', Product2Id: 'p2', ProductSellingModelId: 'sm1', IsActive: true },
      ];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-020 Expired attribute rule ──────────────────────────────
  describe('ARM-020 Expired attribute rule still active', () => {
    const c = getCheck('ARM-020');
    it('FIRES on rule past end date', async () => {
      const d = empty();
      d.attributeBasedAdjRules = [{ Id: 'r1', Name: 'Old Promo', IsActive: true, EffectiveEndDate: todayPlus(-30) }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on rule still in window', async () => {
      const d = empty();
      d.attributeBasedAdjRules = [{ Id: 'r1', Name: 'Current Promo', IsActive: true, EffectiveEndDate: todayPlus(30) }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-021 Active rate card with no entries ────────────────────
  describe('ARM-021 Active rate card with no entries', () => {
    const c = getCheck('ARM-021');
    it('FIRES on empty active rate card', async () => {
      const d = empty();
      d.rateCards = [{ Id: 'rc1', Name: 'API Usage', IsActive: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with entries', async () => {
      const d = empty();
      d.rateCards = [{ Id: 'rc1', Name: 'API Usage', IsActive: true }];
      d.rateCardEntries = [{ Id: 'rce1', RateCardId: 'rc1', Price: 0.01 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-022 RateCardEntry with no price ─────────────────────────
  describe('ARM-022 Rate card entry with no price', () => {
    const c = getCheck('ARM-022');
    it('FIRES on null price', async () => {
      const d = empty();
      d.rateCardEntries = [{ Id: 'rce1', RateCardId: 'rc1' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on positive price', async () => {
      const d = empty();
      d.rateCardEntries = [{ Id: 'rce1', RateCardId: 'rc1', Price: 5 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-024 Picklist attribute with no values ───────────────────
  describe('ARM-024 Picklist attribute with no values', () => {
    const c = getCheck('ARM-024');
    it('FIRES on picklist attribute without values', async () => {
      const d = empty();
      d.attributeDefinitions = [{ Id: 'ad1', Name: 'Color', Code: 'COLOR', DataType: 'Picklist' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when picklist has values', async () => {
      const d = empty();
      d.attributeDefinitions = [{ Id: 'ad1', Name: 'Color', Code: 'COLOR', DataType: 'Picklist' }];
      d.attributePicklistValues = [{ Id: 'apv1', AttributeDefinitionId: 'ad1', Value: 'Red' }];
      expect(await c.run(d)).toHaveLength(0);
    });
    it('PASSES on text attribute (irrelevant)', async () => {
      const d = empty();
      d.attributeDefinitions = [{ Id: 'ad1', Name: 'Notes', Code: 'NOTES', DataType: 'Text' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-025 Required attribute without default ──────────────────
  describe('ARM-025 Required attribute without default value', () => {
    const c = getCheck('ARM-025');
    it('FIRES when required + no default', async () => {
      const d = empty();
      d.attributeDefinitions = [{ Id: 'ad1', Name: 'X', Code: 'X', DataType: 'Text', IsRequired: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with default value', async () => {
      const d = empty();
      d.attributeDefinitions = [{ Id: 'ad1', Name: 'X', Code: 'X', DataType: 'Text', IsRequired: true, DefaultValue: 'default' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-028 Standard pricebook inactive ─────────────────────────
  describe('ARM-028 Standard pricebook inactive', () => {
    const c = getCheck('ARM-028');
    it('FIRES when standard pricebook is inactive', async () => {
      const d = empty();
      d.priceBooks = [{ Id: 'pb_std', Name: 'Standard', IsActive: false, IsStandard: true }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when standard pricebook is active', async () => {
      const d = empty();
      d.priceBooks = [{ Id: 'pb_std', Name: 'Standard', IsActive: true, IsStandard: true }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-031 Active asset without state period ───────────────────
  describe('ARM-031 Active asset without state period', () => {
    const c = getCheck('ARM-031');
    it('FIRES when active asset has no state period', async () => {
      const d = empty();
      d.assets = [{ Id: 'a1', Name: 'Server-X', Status: 'Active' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when state period exists', async () => {
      const d = empty();
      d.assets = [{ Id: 'a1', Name: 'Server-X', Status: 'Active' }];
      d.assetStatePeriods = [{ Id: 'asp1', AssetId: 'a1', IsCurrent: true, Quantity: 1 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-032 Asset past end date but Active ──────────────────────
  describe('ARM-032 Asset past end date', () => {
    const c = getCheck('ARM-032');
    it('FIRES on Active asset with past CurrentLifecycleEndDate', async () => {
      const d = empty();
      d.assets = [{ Id: 'a1', Name: 'X', Status: 'Active', CurrentLifecycleEndDate: todayPlus(-10) }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on Active asset with future end date', async () => {
      const d = empty();
      d.assets = [{ Id: 'a1', Name: 'X', Status: 'Active', CurrentLifecycleEndDate: todayPlus(30) }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-034 Multiple current asset state periods ────────────────
  describe('ARM-034 Multiple current state periods', () => {
    const c = getCheck('ARM-034');
    it('FIRES with 2+ IsCurrent=true periods on same asset', async () => {
      const d = empty();
      d.assetStatePeriods = [
        { Id: 'p1', AssetId: 'a1', IsCurrent: true, Quantity: 5 },
        { Id: 'p2', AssetId: 'a1', IsCurrent: true, Quantity: 3 },
      ];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with single current period', async () => {
      const d = empty();
      d.assetStatePeriods = [{ Id: 'p1', AssetId: 'a1', IsCurrent: true, Quantity: 5 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-036 ContractItemPrice without dates ─────────────────────
  describe('ARM-036 Contract price without dates', () => {
    const c = getCheck('ARM-036');
    it('FIRES on undated contract price', async () => {
      const d = empty();
      d.contractItemPrices = [{ Id: 'cip1', ContractId: 'c1', Product2Id: 'p1', Price: 100 }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with dates set', async () => {
      const d = empty();
      d.contractItemPrices = [{ Id: 'cip1', ContractId: 'c1', Product2Id: 'p1', Price: 100, EffectiveStartDate: '2026-01-01' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-039 Contract reversed dates ─────────────────────────────
  describe('ARM-039 Contract with reversed dates', () => {
    const c = getCheck('ARM-039');
    it('FIRES when StartDate > EndDate', async () => {
      const d = empty();
      d.contracts = [{ Id: 'c1', Status: 'Activated', StartDate: '2026-12-01', EndDate: '2026-01-01' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on chronological dates', async () => {
      const d = empty();
      d.contracts = [{ Id: 'c1', Status: 'Activated', StartDate: '2026-01-01', EndDate: '2026-12-31' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-041 Usage resource not Active ───────────────────────────
  describe('ARM-041 UsageResource not Active', () => {
    const c = getCheck('ARM-041');
    it('FIRES on Draft usage resource', async () => {
      const d = empty();
      d.usageResources = [{ Id: 'ur1', Name: 'API Calls', Status: 'Draft' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on Active usage resource', async () => {
      const d = empty();
      d.usageResources = [{ Id: 'ur1', Name: 'API Calls', Status: 'Active' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-043 Usage grant reversed dates ──────────────────────────
  describe('ARM-043 Usage grant reversed dates', () => {
    const c = getCheck('ARM-043');
    it('FIRES on reversed dates', async () => {
      const d = empty();
      d.productUsageGrants = [{ Id: 'pug1', Name: 'Trial', EffectiveStartDate: '2026-12-01', EffectiveEndDate: '2026-01-01' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES on chronological dates', async () => {
      const d = empty();
      d.productUsageGrants = [{ Id: 'pug1', Name: 'Trial', EffectiveStartDate: '2026-01-01', EffectiveEndDate: '2026-12-31' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-046 Empty fulfillment step group ────────────────────────
  describe('ARM-046 Empty fulfillment step group', () => {
    const c = getCheck('ARM-046');
    it('FIRES when group has no steps', async () => {
      const d = empty();
      d.fulfillmentStepDefinitionGroups = [{ Id: 'g1', Name: 'Empty', Status: 'Active' }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES with steps assigned', async () => {
      const d = empty();
      d.fulfillmentStepDefinitionGroups = [{ Id: 'g1', Name: 'Group', Status: 'Active' }];
      d.fulfillmentStepDefinitions = [{ Id: 's1', Name: 'Step', Status: 'Active', FulfillmentStepDefinitionGroupId: 'g1' }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });

  // ─── ARM-049 Active cost book with no entries ────────────────────
  describe('ARM-049 Active cost book with no entries', () => {
    const c = getCheck('ARM-049');
    it('FIRES on empty active cost book', async () => {
      const d = empty();
      d.costBooks = [{ Id: 'cb1', Name: 'Standard Costs', IsActive: true, IsStandard: false }];
      expect(await c.run(d)).toHaveLength(1);
    });
    it('PASSES when entries exist', async () => {
      const d = empty();
      d.costBooks = [{ Id: 'cb1', Name: 'Standard Costs', IsActive: true, IsStandard: false }];
      d.costBookEntries = [{ Id: 'cbe1', CostBookId: 'cb1', Cost: 50 }];
      expect(await c.run(d)).toHaveLength(0);
    });
  });
});
