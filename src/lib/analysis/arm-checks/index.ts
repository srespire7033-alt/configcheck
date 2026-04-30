import type { ARMHealthCheck, ARMData, Issue } from '@/types';

/**
 * ARM (Revenue Cloud / RLM) v1 health checks.
 *
 * 10 checks across 9 categories targeting the most common Revenue Cloud
 * misconfiguration patterns documented in the Revenue Cloud Developer Guide
 * (Spring '26). All queries run against Salesforce *standard* objects.
 */
export const armChecks: ARMHealthCheck[] = [
  // ─────────────────────────────────────────────────────────────────
  // ARM-001: Active product without ProductSellingModelOption
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-001',
    name: 'Active Product Without Selling Model',
    category: 'arm_product_catalog',
    severity: 'critical',
    description:
      'Active products that have no ProductSellingModelOption — they cannot be quoted',
    run: async (data: ARMData): Promise<Issue[]> => {
      const productsWithModel = new Set(
        data.sellingModelOptions.filter((o) => o.IsActive).map((o) => o.Product2Id)
      );
      const orphans = data.products.filter(
        (p) => p.IsActive && !productsWithModel.has(p.Id)
      );
      if (orphans.length === 0) return [];
      return [
        {
          check_id: 'ARM-001',
          category: 'arm_product_catalog',
          severity: 'critical',
          title: `${orphans.length} active product(s) have no selling model`,
          description: `${orphans.length} active product(s) lack an active ProductSellingModelOption. Without a selling model assignment, these products can't be added to a Revenue Cloud quote. Examples: ${orphans
            .slice(0, 3)
            .map((p) => `"${p.Name}"`)
            .join(', ')}.`,
          impact:
            'Sales reps will see configuration or runtime errors when trying to quote these products.',
          recommendation:
            'Create an active ProductSellingModelOption record linking each product to a ProductSellingModel that matches your business model (OneTime, TermDefined, or Evergreen).',
          affected_records: orphans.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-002: Selling model with no billing frequency
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-002',
    name: 'Selling Model Without Billing Frequency',
    category: 'arm_selling_models',
    severity: 'critical',
    description:
      'Term-based or Evergreen selling models that have no SellingFrequencyId set',
    run: async (data: ARMData): Promise<Issue[]> => {
      const recurring = data.sellingModels.filter((m) => {
        if (!m.IsActive) return false;
        const t = (m.SellingModelType || '').toLowerCase();
        return t.includes('term') || t.includes('evergreen');
      });
      const missing = recurring.filter((m) => !m.SellingFrequencyId);
      if (missing.length === 0) return [];
      return [
        {
          check_id: 'ARM-002',
          category: 'arm_selling_models',
          severity: 'critical',
          title: `${missing.length} recurring selling model(s) missing billing frequency`,
          description: `${missing.length} active selling model(s) of type Term or Evergreen have no SellingFrequencyId. Recurring models need a frequency to drive billing schedules. Examples: ${missing
            .slice(0, 3)
            .map((m) => `"${m.Name}"`)
            .join(', ')}.`,
          impact:
            'Billing schedules will not generate correctly for products tied to these selling models.',
          recommendation:
            'Set SellingFrequencyId on each recurring ProductSellingModel to point at the appropriate frequency record (monthly, quarterly, annual, etc.).',
          affected_records: missing.slice(0, 25).map((m) => ({
            id: m.Id,
            name: m.Name,
            type: 'ProductSellingModel',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-003: Price adjustment schedules with overlapping tiers
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-003',
    name: 'Overlapping Price Adjustment Tiers',
    category: 'arm_price_adjustments',
    severity: 'warning',
    description:
      'Tiers within the same PriceAdjustmentSchedule whose quantity ranges overlap',
    run: async (data: ARMData): Promise<Issue[]> => {
      // Group tiers by their parent schedule
      const tiersBySchedule: Record<string, typeof data.priceAdjustmentTiers> = {};
      for (const t of data.priceAdjustmentTiers) {
        if (!tiersBySchedule[t.PriceAdjustmentScheduleId]) {
          tiersBySchedule[t.PriceAdjustmentScheduleId] = [];
        }
        tiersBySchedule[t.PriceAdjustmentScheduleId].push(t);
      }

      const overlapping: Array<{ scheduleId: string; scheduleName: string }> = [];
      const scheduleNames: Record<string, string> = {};
      for (const s of data.priceAdjustmentSchedules) scheduleNames[s.Id] = s.Name;

      for (const [scheduleId, tiers] of Object.entries(tiersBySchedule)) {
        // Sort by lower bound ascending; treat null as 0
        const sorted = [...tiers].sort(
          (a, b) => (a.LowerBound ?? 0) - (b.LowerBound ?? 0)
        );
        for (let i = 0; i < sorted.length - 1; i++) {
          const cur = sorted[i];
          const next = sorted[i + 1];
          const curUpper = cur.UpperBound ?? Infinity;
          const nextLower = next.LowerBound ?? 0;
          if (curUpper > nextLower) {
            overlapping.push({
              scheduleId,
              scheduleName: scheduleNames[scheduleId] || scheduleId,
            });
            break;
          }
        }
      }
      if (overlapping.length === 0) return [];
      return [
        {
          check_id: 'ARM-003',
          category: 'arm_price_adjustments',
          severity: 'warning',
          title: `${overlapping.length} schedule(s) with overlapping tiers`,
          description: `${overlapping.length} PriceAdjustmentSchedule(s) have tiers whose quantity ranges overlap. When tiers overlap, the engine may apply ambiguous discounts. Examples: ${overlapping
            .slice(0, 3)
            .map((o) => `"${o.scheduleName}"`)
            .join(', ')}.`,
          impact:
            'Pricing may be inconsistent across quotes — sales reps see different totals for the same input.',
          recommendation:
            'Audit each PriceAdjustmentTier so consecutive tiers are contiguous (UpperBound of tier N equals LowerBound of tier N+1).',
          affected_records: overlapping.slice(0, 25).map((o) => ({
            id: o.scheduleId,
            name: o.scheduleName,
            type: 'PriceAdjustmentSchedule',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-004: AttributeBasedAdjRule without effective dates
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-004',
    name: 'Attribute Adjustment Rule Without Effective Dates',
    category: 'arm_attribute_pricing',
    severity: 'warning',
    description:
      'Active AttributeBasedAdjRule records with no EffectiveStartDate or EffectiveEndDate',
    run: async (data: ARMData): Promise<Issue[]> => {
      const undated = data.attributeBasedAdjRules.filter(
        (r) => r.IsActive && !r.EffectiveStartDate && !r.EffectiveEndDate
      );
      if (undated.length === 0) return [];
      return [
        {
          check_id: 'ARM-004',
          category: 'arm_attribute_pricing',
          severity: 'warning',
          title: `${undated.length} attribute rule(s) without effective dates`,
          description: `${undated.length} active AttributeBasedAdjRule(s) have neither an effective start nor end date. Without dating, these rules apply indefinitely and may continue running long after they should expire. Examples: ${undated
            .slice(0, 3)
            .map((r) => `"${r.Name}"`)
            .join(', ')}.`,
          impact:
            'Old promotional rules can keep firing on new quotes — leading to silent revenue leakage.',
          recommendation:
            'Add at minimum an EffectiveStartDate to every active attribute rule, and an EffectiveEndDate for any time-bounded promotion.',
          affected_records: undated.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'AttributeBasedAdjRule',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-005: Bundle parent without related components (empty bundle)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-005',
    name: 'Empty Bundle (No Related Components)',
    category: 'arm_bundles',
    severity: 'critical',
    description:
      'Products that act as parents in the catalog but have no ProductRelatedComponent children',
    run: async (data: ARMData): Promise<Issue[]> => {
      // Heuristic: a product is a bundle parent if it has no child component
      // entries pointing INTO it as a child but has no children of its own,
      // and its name suggests a bundle. We simplify: any product referenced
      // as a ParentProductId by zero records but referenced by ProductCategoryProduct
      // would imply it's catalogued as something. We instead surface products
      // explicitly named with "Bundle" but lacking ProductRelatedComponent rows.
      const parentsInComponents = new Set(
        data.productRelatedComponents.map((c) => c.ParentProductId)
      );
      const childInComponents = new Set(
        data.productRelatedComponents.map((c) => c.ChildProductId)
      );

      // Look for products that look like bundles (name hint OR family hint)
      // but don't appear as a parent in productRelatedComponents.
      const looksLikeBundle = (name: string, family?: string | null) => {
        const n = (name || '').toLowerCase();
        const f = (family || '').toLowerCase();
        return n.includes('bundle') || f.includes('bundle');
      };

      const empties = data.products.filter(
        (p) =>
          p.IsActive &&
          looksLikeBundle(p.Name, p.Family) &&
          !parentsInComponents.has(p.Id) &&
          !childInComponents.has(p.Id)
      );
      if (empties.length === 0) return [];
      return [
        {
          check_id: 'ARM-005',
          category: 'arm_bundles',
          severity: 'critical',
          title: `${empties.length} bundle product(s) with no components`,
          description: `${empties.length} active product(s) appear to be bundles (named or categorised as such) but have no ProductRelatedComponent children. Sales reps will be unable to add their constituent items. Examples: ${empties
            .slice(0, 3)
            .map((p) => `"${p.Name}"`)
            .join(', ')}.`,
          impact:
            'Bundles cannot be configured during quoting — affected products effectively act as one-line stand-ins.',
          recommendation:
            'Either add ProductRelatedComponent rows for each child, or rename/recategorise these so they aren\'t treated as bundles.',
          affected_records: empties.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-006: Pricing procedure with no resolution policy
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-006',
    name: 'Pricing Procedure Without Resolution Policy',
    category: 'arm_pricing_procedures',
    severity: 'warning',
    description:
      'Active PricingProcedure records with no ResolutionPolicy set',
    run: async (data: ARMData): Promise<Issue[]> => {
      const missing = data.pricingProcedures.filter(
        (p) => p.IsActive && !p.ResolutionPolicy
      );
      if (missing.length === 0) return [];
      return [
        {
          check_id: 'ARM-006',
          category: 'arm_pricing_procedures',
          severity: 'warning',
          title: `${missing.length} pricing procedure(s) without resolution policy`,
          description: `${missing.length} active PricingProcedure(s) have no ResolutionPolicy. Without one, ambiguous price-rule matches don't have a deterministic winner. Examples: ${missing
            .slice(0, 3)
            .map((p) => `"${p.Name}"`)
            .join(', ')}.`,
          impact:
            'When multiple pricing rules could apply to the same line, the result becomes order-dependent and harder to reproduce.',
          recommendation:
            'Set a ResolutionPolicy (e.g., HighestPriority) on every active pricing procedure.',
          affected_records: missing.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'PricingProcedure',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-007: Multiple active price books per currency without segmentation
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-007',
    name: 'Multiple Active Price Books Per Currency',
    category: 'arm_price_books',
    severity: 'info',
    description:
      'More than one active non-standard Pricebook2 exists for the same currency',
    run: async (data: ARMData): Promise<Issue[]> => {
      const byCurrency: Record<string, typeof data.priceBooks> = {};
      for (const pb of data.priceBooks) {
        if (!pb.IsActive || pb.IsStandard) continue;
        const cur = pb.CurrencyIsoCode || 'NONE';
        if (!byCurrency[cur]) byCurrency[cur] = [];
        byCurrency[cur].push(pb);
      }
      const conflicts = Object.entries(byCurrency).filter(([, list]) => list.length > 1);
      if (conflicts.length === 0) return [];
      const allConflicting = conflicts.flatMap(([, list]) => list);
      return [
        {
          check_id: 'ARM-007',
          category: 'arm_price_books',
          severity: 'info',
          title: `${conflicts.length} currenc${conflicts.length === 1 ? 'y' : 'ies'} with multiple active price books`,
          description: `${conflicts.length} currenc${conflicts.length === 1 ? 'y has' : 'ies have'} more than one active non-standard Pricebook2. ${conflicts
            .map(([cur, list]) => `${cur}: ${list.map((pb) => `"${pb.Name}"`).join(', ')}`)
            .slice(0, 3)
            .join('; ')}.`,
          impact:
            'Without clear segmentation (region, channel, customer tier), sales reps may pick the wrong price book and apply unexpected pricing.',
          recommendation:
            'Document the segmentation logic for each price book or consolidate redundant books. Consider adding a sharing rule or trigger to enforce the right pick.',
          affected_records: allConflicting.slice(0, 25).map((pb) => ({
            id: pb.Id,
            name: pb.Name,
            type: 'Pricebook2',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-008: Decision table not in Active state
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-008',
    name: 'Inactive or Draft Decision Tables',
    category: 'arm_decision_tables',
    severity: 'warning',
    description:
      'Decision tables that are still in Draft or Inactive state may indicate abandoned configuration',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactive = data.decisionTables.filter((d) => {
        const status = (d.Status || '').toLowerCase();
        return status !== 'active';
      });
      if (inactive.length === 0) return [];
      return [
        {
          check_id: 'ARM-008',
          category: 'arm_decision_tables',
          severity: 'warning',
          title: `${inactive.length} decision table(s) not Active`,
          description: `${inactive.length} DecisionTable record(s) are in Draft, Inactive, or another non-Active status. They will not run at evaluation time — if they were meant to be in production, this is a configuration gap. Examples: ${inactive
            .slice(0, 3)
            .map((d) => `"${d.MasterLabel}" (${d.Status})`)
            .join(', ')}.`,
          impact:
            'Business logic intended to run on every quote/order may be silently skipped.',
          recommendation:
            'Review each decision table — activate the ones meant to be live, delete or rename the ones that are abandoned WIP.',
          affected_records: inactive.slice(0, 25).map((d) => ({
            id: d.Id,
            name: d.MasterLabel,
            type: 'DecisionTable',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-009: Inactive context definitions
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-009',
    name: 'Inactive Context Definitions',
    category: 'arm_context_service',
    severity: 'warning',
    description:
      'ContextDefinition records that are inactive but may still be referenced by other ARM components',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactive = data.contextDefinitions.filter((c) => !c.IsActive);
      if (inactive.length === 0) return [];
      return [
        {
          check_id: 'ARM-009',
          category: 'arm_context_service',
          severity: 'warning',
          title: `${inactive.length} inactive context definition(s)`,
          description: `${inactive.length} ContextDefinition record(s) are inactive. If pricing procedures or expression sets reference them, those flows may fail at runtime. Examples: ${inactive
            .slice(0, 3)
            .map((c) => `"${c.DeveloperName}"`)
            .join(', ')}.`,
          impact:
            'Downstream components depending on these definitions may produce errors or empty results.',
          recommendation:
            'Either reactivate, delete, or replace each inactive definition. Verify no active flow still references it.',
          affected_records: inactive.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.DeveloperName,
            type: 'ContextDefinition',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-010: Inactive product category still referenced by active products
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-010',
    name: 'Inactive Product Category With Active Products',
    category: 'arm_product_catalog',
    severity: 'info',
    description:
      'ProductCategory records flagged inactive that still have active Product2 records assigned',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactiveCategoryIds = new Set(
        data.productCategories
          .filter((c) => c.IsActive === false)
          .map((c) => c.Id)
      );
      if (inactiveCategoryIds.size === 0) return [];
      const productNames: Record<string, string> = {};
      for (const p of data.products) productNames[p.Id] = p.Name;
      const activeProductIds = new Set(
        data.products.filter((p) => p.IsActive).map((p) => p.Id)
      );
      const stale = data.productCategoryProducts.filter(
        (pcp) => inactiveCategoryIds.has(pcp.ProductCategoryId) && activeProductIds.has(pcp.ProductId)
      );
      if (stale.length === 0) return [];
      const categoryNames: Record<string, string> = {};
      for (const c of data.productCategories) categoryNames[c.Id] = c.Name;

      return [
        {
          check_id: 'ARM-010',
          category: 'arm_product_catalog',
          severity: 'info',
          title: `${stale.length} active product(s) in inactive categor${stale.length === 1 ? 'y' : 'ies'}`,
          description: `${stale.length} ProductCategoryProduct relationship(s) link an active product to an inactive category. Customers searching the catalog may not see these products surfaced correctly.`,
          impact:
            'Catalog navigation gaps — products may not appear under expected category browse paths.',
          recommendation:
            'Either reactivate the categories, or move the products to an active category, or remove the stale ProductCategoryProduct rows.',
          affected_records: stale.slice(0, 25).map((pcp) => ({
            id: pcp.Id,
            name: `${productNames[pcp.ProductId] || pcp.ProductId} → ${categoryNames[pcp.ProductCategoryId] || pcp.ProductCategoryId}`,
            type: 'ProductCategoryProduct',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-011: Term selling model without pricing term
  // RLM doc: term-defined selling models drive billing/contract length —
  // a missing PricingTerm causes ambiguous quote calculations.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-011',
    name: 'Term Selling Model Without Pricing Term',
    category: 'arm_selling_models',
    severity: 'warning',
    description:
      'Active term-defined selling models with no PricingTerm value',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.sellingModels.filter((m) => {
        if (!m.IsActive) return false;
        const t = (m.SellingModelType || '').toLowerCase();
        if (!t.includes('term')) return false;
        return !m.PricingTerm || m.PricingTerm <= 0;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-011',
          category: 'arm_selling_models',
          severity: 'warning',
          title: `${offenders.length} term selling model(s) missing pricing term`,
          description: `${offenders.length} active term-defined ProductSellingModel(s) have no PricingTerm or a zero value. Without a defined term, contract duration and billing cadence become ambiguous. Examples: ${offenders.slice(0, 3).map((m) => `"${m.Name}"`).join(', ')}.`,
          impact:
            'Quotes built on these models may produce unpredictable billing schedules and contract end dates.',
          recommendation:
            'Set PricingTerm to a positive integer matching your billing model (e.g. 1, 12, 24, 36) and confirm PricingTermUnit is set as well.',
          affected_records: offenders.slice(0, 25).map((m) => ({
            id: m.Id,
            name: m.Name,
            type: 'ProductSellingModel',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-012: Active option referencing inactive selling model
  // RLM doc: "All product data definitions must be active to appear in
  // the sales channels." Inactive parents break downstream lookups.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-012',
    name: 'Active Option Referencing Inactive Selling Model',
    category: 'arm_selling_models',
    severity: 'warning',
    description:
      'ProductSellingModelOption is active but the referenced ProductSellingModel is inactive',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactiveModelIds = new Set(
        data.sellingModels.filter((m) => !m.IsActive).map((m) => m.Id)
      );
      if (inactiveModelIds.size === 0) return [];
      const offenders = data.sellingModelOptions.filter(
        (o) => o.IsActive && inactiveModelIds.has(o.ProductSellingModelId)
      );
      if (offenders.length === 0) return [];
      const productNames: Record<string, string> = {};
      for (const p of data.products) productNames[p.Id] = p.Name;
      const modelNames: Record<string, string> = {};
      for (const m of data.sellingModels) modelNames[m.Id] = m.Name;
      return [
        {
          check_id: 'ARM-012',
          category: 'arm_selling_models',
          severity: 'warning',
          title: `${offenders.length} active option(s) point at an inactive selling model`,
          description: `${offenders.length} active ProductSellingModelOption record(s) reference a ProductSellingModel that is inactive. Sales channels won't be able to resolve these mappings at runtime.`,
          impact:
            'Affected products will silently fail to surface in catalog/quoting flows that depend on the inactive selling model.',
          recommendation:
            'Either reactivate the parent selling model, retire the orphan options, or repoint each option at an active model.',
          affected_records: offenders.slice(0, 25).map((o) => ({
            id: o.Id,
            name: `${productNames[o.Product2Id] || o.Product2Id} → ${modelNames[o.ProductSellingModelId] || o.ProductSellingModelId} (inactive)`,
            type: 'ProductSellingModelOption',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-013: Bundle component min > max quantity
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-013',
    name: 'Bundle Component Min/Max Quantity Mismatch',
    category: 'arm_bundles',
    severity: 'critical',
    description:
      'ProductRelatedComponent records where MinQuantity exceeds MaxQuantity',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.productRelatedComponents.filter(
        (c) =>
          c.MinQuantity != null &&
          c.MaxQuantity != null &&
          c.MinQuantity > c.MaxQuantity
      );
      if (offenders.length === 0) return [];
      const productNames: Record<string, string> = {};
      for (const p of data.products) productNames[p.Id] = p.Name;
      return [
        {
          check_id: 'ARM-013',
          category: 'arm_bundles',
          severity: 'critical',
          title: `${offenders.length} bundle component(s) with impossible quantity range`,
          description: `${offenders.length} ProductRelatedComponent record(s) have MinQuantity > MaxQuantity, which makes the configurator unable to satisfy the constraint. The component will either always trigger an error or be silently skipped.`,
          impact:
            'Sales reps cannot complete configuration of these bundles — runtime validation errors block quote save.',
          recommendation:
            'Fix the MinQuantity/MaxQuantity values so the range is internally consistent (Min ≤ Max).',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: `${productNames[c.ParentProductId] || c.ParentProductId} → ${productNames[c.ChildProductId] || c.ChildProductId} (Min ${c.MinQuantity}, Max ${c.MaxQuantity})`,
            type: 'ProductRelatedComponent',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-014: Bundle component pointing to inactive child product
  // RLM doc: product definitions must be active to appear in sales channels.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-014',
    name: 'Bundle Component Points to Inactive Child Product',
    category: 'arm_bundles',
    severity: 'warning',
    description:
      'ProductRelatedComponent rows where the child product is no longer active',
    run: async (data: ARMData): Promise<Issue[]> => {
      const productActive: Record<string, boolean> = {};
      const productName: Record<string, string> = {};
      for (const p of data.products) {
        productActive[p.Id] = p.IsActive;
        productName[p.Id] = p.Name;
      }
      const offenders = data.productRelatedComponents.filter((c) => {
        const active = productActive[c.ChildProductId];
        return active === false;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-014',
          category: 'arm_bundles',
          severity: 'warning',
          title: `${offenders.length} bundle component(s) reference inactive children`,
          description: `${offenders.length} ProductRelatedComponent record(s) point to a child Product2 marked as inactive. The component will be hidden in selling flows but its parent bundle still expects it to exist.`,
          impact:
            'Bundles configured with these components may surface errors or omit the option silently.',
          recommendation:
            'Reactivate the child product, replace it with an active equivalent, or remove the component row.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: `${productName[c.ParentProductId] || c.ParentProductId} → ${productName[c.ChildProductId] || c.ChildProductId} (inactive)`,
            type: 'ProductRelatedComponent',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-015: Bundle parent inactive but components still defined
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-015',
    name: 'Inactive Bundle Parent Still Has Components',
    category: 'arm_bundles',
    severity: 'info',
    description:
      'ProductRelatedComponent rows whose ParentProductId points to an inactive Product2',
    run: async (data: ARMData): Promise<Issue[]> => {
      const productActive: Record<string, boolean> = {};
      const productName: Record<string, string> = {};
      for (const p of data.products) {
        productActive[p.Id] = p.IsActive;
        productName[p.Id] = p.Name;
      }
      const offenders = data.productRelatedComponents.filter(
        (c) => productActive[c.ParentProductId] === false
      );
      if (offenders.length === 0) return [];
      // Reduce noise by reporting one row per parent
      const byParent: Record<string, number> = {};
      for (const o of offenders) byParent[o.ParentProductId] = (byParent[o.ParentProductId] || 0) + 1;
      const parents = Object.entries(byParent);
      return [
        {
          check_id: 'ARM-015',
          category: 'arm_bundles',
          severity: 'info',
          title: `${parents.length} inactive bundle parent(s) still have components defined`,
          description: `${parents.length} inactive parent product(s) still have ${offenders.length} ProductRelatedComponent row(s) attached. These components are dormant data but add maintenance overhead.`,
          impact:
            'Cleanup task — no immediate runtime risk, but stale relationships make future audits harder.',
          recommendation:
            'Either reactivate the parent product if it should still be sold, or delete the obsolete ProductRelatedComponent rows.',
          affected_records: parents.slice(0, 25).map(([parentId, count]) => ({
            id: parentId,
            name: `${productName[parentId] || parentId} (${count} component${count !== 1 ? 's' : ''})`,
            type: 'Product2',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-016: Active price adjustment schedule with no tiers
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-016',
    name: 'Active Price Adjustment Schedule With No Tiers',
    category: 'arm_price_adjustments',
    severity: 'warning',
    description:
      'PriceAdjustmentSchedule is active but has no PriceAdjustmentTier rows',
    run: async (data: ARMData): Promise<Issue[]> => {
      const tiersBySchedule: Record<string, number> = {};
      for (const t of data.priceAdjustmentTiers) {
        tiersBySchedule[t.PriceAdjustmentScheduleId] =
          (tiersBySchedule[t.PriceAdjustmentScheduleId] || 0) + 1;
      }
      const empties = data.priceAdjustmentSchedules.filter(
        (s) => s.IsActive && !tiersBySchedule[s.Id]
      );
      if (empties.length === 0) return [];
      return [
        {
          check_id: 'ARM-016',
          category: 'arm_price_adjustments',
          severity: 'warning',
          title: `${empties.length} active price schedule(s) with no tiers`,
          description: `${empties.length} active PriceAdjustmentSchedule(s) have zero PriceAdjustmentTier records configured. The schedule has no effect at runtime — it acts as a no-op. Examples: ${empties.slice(0, 3).map((s) => `"${s.Name}"`).join(', ')}.`,
          impact:
            'Either configuration was abandoned mid-setup or the schedule is dead code. Either way, it adds noise to pricing flows.',
          recommendation:
            'Add tiers if the schedule was meant to be active, or deactivate/delete the schedule if it is no longer needed.',
          affected_records: empties.slice(0, 25).map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'PriceAdjustmentSchedule',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-017: Price adjustment tier with invalid bounds (Lower > Upper)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-017',
    name: 'Price Adjustment Tier With Invalid Bounds',
    category: 'arm_price_adjustments',
    severity: 'critical',
    description:
      'PriceAdjustmentTier rows where LowerBound is greater than UpperBound',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.priceAdjustmentTiers.filter(
        (t) =>
          t.LowerBound != null &&
          t.UpperBound != null &&
          t.LowerBound > t.UpperBound
      );
      if (offenders.length === 0) return [];
      const scheduleNames: Record<string, string> = {};
      for (const s of data.priceAdjustmentSchedules) scheduleNames[s.Id] = s.Name;
      return [
        {
          check_id: 'ARM-017',
          category: 'arm_price_adjustments',
          severity: 'critical',
          title: `${offenders.length} tier(s) with reversed quantity bounds`,
          description: `${offenders.length} PriceAdjustmentTier(s) have LowerBound greater than UpperBound. The tier can never match any quantity, so its adjustment is dead code (or worse, masks a typo that should have applied).`,
          impact:
            'Pricing logic is silently broken — quotes will not receive the intended discount/markup.',
          recommendation:
            'Swap the LowerBound and UpperBound values, or correct whichever value is wrong.',
          affected_records: offenders.slice(0, 25).map((t) => ({
            id: t.Id,
            name: `${scheduleNames[t.PriceAdjustmentScheduleId] || t.PriceAdjustmentScheduleId} (Lower ${t.LowerBound}, Upper ${t.UpperBound})`,
            type: 'PriceAdjustmentTier',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-018: Active products with no category assignment
  // RLM doc: "All product data definitions must be active to appear in
  // the sales channels" — products without category assignment fail
  // catalog discovery / browse paths.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-018',
    name: 'Active Product Without Category Assignment',
    category: 'arm_product_catalog',
    severity: 'info',
    description:
      'Active Product2 records that have no ProductCategoryProduct row attached',
    run: async (data: ARMData): Promise<Issue[]> => {
      const productsInCategory = new Set(
        data.productCategoryProducts.map((pcp) => pcp.ProductId)
      );
      const orphans = data.products.filter(
        (p) => p.IsActive && !productsInCategory.has(p.Id)
      );
      if (orphans.length === 0) return [];
      return [
        {
          check_id: 'ARM-018',
          category: 'arm_product_catalog',
          severity: 'info',
          title: `${orphans.length} active product(s) without category assignment`,
          description: `${orphans.length} active product(s) have no ProductCategoryProduct rows. Customers browsing the catalog by category will not find these products. Examples: ${orphans.slice(0, 3).map((p) => `"${p.Name}"`).join(', ')}.`,
          impact:
            'Catalog discoverability gap — affected products only surface via direct search, not category browse.',
          recommendation:
            'Assign each product to at least one ProductCategory via a ProductCategoryProduct record.',
          affected_records: orphans.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'Product2',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-019: Duplicate selling model options for same product
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-019',
    name: 'Duplicate Selling Model Options',
    category: 'arm_selling_models',
    severity: 'warning',
    description:
      'Multiple active ProductSellingModelOption records for the same Product + SellingModel pair',
    run: async (data: ARMData): Promise<Issue[]> => {
      const grouped: Record<string, typeof data.sellingModelOptions> = {};
      for (const o of data.sellingModelOptions) {
        if (!o.IsActive) continue;
        const key = `${o.Product2Id}|${o.ProductSellingModelId}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(o);
      }
      const dupes = Object.entries(grouped).filter(([, arr]) => arr.length > 1);
      if (dupes.length === 0) return [];
      const productNames: Record<string, string> = {};
      for (const p of data.products) productNames[p.Id] = p.Name;
      const modelNames: Record<string, string> = {};
      for (const m of data.sellingModels) modelNames[m.Id] = m.Name;
      const allDupeRows = dupes.flatMap(([, arr]) => arr);
      return [
        {
          check_id: 'ARM-019',
          category: 'arm_selling_models',
          severity: 'warning',
          title: `${dupes.length} duplicate selling model option pair(s)`,
          description: `${dupes.length} (Product, SellingModel) pair${dupes.length === 1 ? '' : 's'} have more than one active ProductSellingModelOption. Duplicates make it nondeterministic which option drives quoting — the engine may pick whichever it iterates first.`,
          impact:
            'Sales reps can see different price/term outcomes for the same product depending on the option chosen by the engine.',
          recommendation:
            'Deactivate or delete the redundant options so each (Product, SellingModel) pair has exactly one active row.',
          affected_records: allDupeRows.slice(0, 25).map((o) => ({
            id: o.Id,
            name: `${productNames[o.Product2Id] || o.Product2Id} ↔ ${modelNames[o.ProductSellingModelId] || o.ProductSellingModelId}`,
            type: 'ProductSellingModelOption',
          })),
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // ARM-020: Expired AttributeBasedAdjRule still active
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ARM-020',
    name: 'Expired Attribute Adjustment Rule Still Active',
    category: 'arm_attribute_pricing',
    severity: 'info',
    description:
      'AttributeBasedAdjRule with an EffectiveEndDate in the past but IsActive=true',
    run: async (data: ARMData): Promise<Issue[]> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const offenders = data.attributeBasedAdjRules.filter((r) => {
        if (!r.IsActive) return false;
        if (!r.EffectiveEndDate) return false;
        return r.EffectiveEndDate < todayIso;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-020',
          category: 'arm_attribute_pricing',
          severity: 'info',
          title: `${offenders.length} attribute rule(s) past their end date`,
          description: `${offenders.length} active AttributeBasedAdjRule(s) have an EffectiveEndDate before today but remain flagged active. Cleanup task — they no longer apply to new quotes.`,
          impact:
            'Low — most pricing engines respect the date filter at evaluation time. But the rule list grows over time and slows audits.',
          recommendation:
            'Set IsActive=false on each expired rule, or extend the EffectiveEndDate if the rule should still apply.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: `${r.Name} (ended ${r.EffectiveEndDate})`,
            type: 'AttributeBasedAdjRule',
          })),
        },
      ];
    },
  },
];
