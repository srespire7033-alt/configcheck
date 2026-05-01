import type { ARMHealthCheck, ARMData, Issue, RLMAsset, RLMCostBook } from '@/types';

/**
 * ARM (Revenue Cloud / RLM) v1 health checks.
 *
 * 10 checks across 9 categories targeting the most common Revenue Cloud
 * misconfiguration patterns documented in the Revenue Cloud Developer Guide
 * (Summer '26). All queries run against Salesforce *standard* objects.
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
      // Don't fire if the org isn't using ProductSellingModel at all —
      // many partial-RLM orgs have BillingSchedule but no ProductSellingModel,
      // and we'd otherwise flag every product as orphaned (false positive).
      if (data.sellingModels.length === 0 && data.sellingModelOptions.length === 0) {
        return [];
      }
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
      // Don't fire if the org isn't using ProductRelatedComponent at all —
      // a partial-RLM org without this object would have every "Bundle"-named
      // product flagged, which isn't actionable.
      if (data.productRelatedComponents.length === 0) {
        return [];
      }
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
      'PricingProcedure records that lack a Pricing usage type',
    run: async (data: ARMData): Promise<Issue[]> => {
      // ExpressionSet schema at v66 dropped ResolutionPolicy / IsActive in
      // favor of UsageType + InterfaceSourceType. The Pricing UsageType is
      // what makes a procedure participate in pricing — anything without
      // a usage type set is mis-configured.
      const missing = data.pricingProcedures.filter((p) => !p.UsageType);
      if (missing.length === 0) return [];
      return [
        {
          check_id: 'ARM-006',
          category: 'arm_pricing_procedures',
          severity: 'warning',
          title: `${missing.length} pricing procedure(s) without UsageType`,
          description: `${missing.length} ExpressionSet procedure(s) have no UsageType. Without one, the procedure isn't routed to the pricing engine. Examples: ${missing
            .slice(0, 3)
            .map((p) => `"${p.ApiName}"`)
            .join(', ')}.`,
          impact:
            'A procedure without UsageType won\'t participate in price calculation and silently does nothing.',
          recommendation:
            'Set UsageType to "Pricing" or "PricingDiscovery" on every pricing procedure.',
          affected_records: missing.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.ApiName,
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
      // Don't fire if the org isn't using ProductCategory at all —
      // would otherwise flag every product in an org that doesn't use
      // catalogue categorisation.
      if (data.productCategories.length === 0 && data.productCategoryProducts.length === 0) {
        return [];
      }
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

  // ═════════════════════════════════════════════════════════════════
  // RATE CARDS  (arm_rate_cards) — 3 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-021: Active RateCard with no entries
  {
    id: 'ARM-021',
    name: 'Active Rate Card With No Entries',
    category: 'arm_rate_cards',
    severity: 'warning',
    description:
      'RateCard is active but has no RateCardEntry rows configured',
    run: async (data: ARMData): Promise<Issue[]> => {
      const entriesByCard: Record<string, number> = {};
      for (const e of data.rateCardEntries) {
        entriesByCard[e.RateCardId] = (entriesByCard[e.RateCardId] || 0) + 1;
      }
      const empties = data.rateCards.filter(
        (rc) => rc.IsActive && !entriesByCard[rc.Id]
      );
      if (empties.length === 0) return [];
      return [
        {
          check_id: 'ARM-021',
          category: 'arm_rate_cards',
          severity: 'warning',
          title: `${empties.length} active rate card(s) with no entries`,
          description: `${empties.length} active RateCard(s) have zero RateCardEntry records. The rate card has no effect on usage pricing — quotes referencing it will fall back to default pricing or fail. Examples: ${empties.slice(0, 3).map((rc) => `"${rc.Name}"`).join(', ')}.`,
          impact:
            'Usage-based products tied to these rate cards will not be priced correctly.',
          recommendation:
            'Add RateCardEntry rows for each product/usage tier, or deactivate the rate card if it is no longer needed.',
          affected_records: empties.slice(0, 25).map((rc) => ({
            id: rc.Id,
            name: rc.Name,
            type: 'RateCard',
          })),
        },
      ];
    },
  },

  // ARM-022: RateCardEntry with null/zero price
  {
    id: 'ARM-022',
    name: 'Rate Card Entry With No Price',
    category: 'arm_rate_cards',
    severity: 'warning',
    description: 'RateCardEntry rows where Price is null or zero',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.rateCardEntries.filter(
        (e) => e.Price == null || e.Price === 0
      );
      if (offenders.length === 0) return [];
      const cardNames: Record<string, string> = {};
      for (const rc of data.rateCards) cardNames[rc.Id] = rc.Name;
      return [
        {
          check_id: 'ARM-022',
          category: 'arm_rate_cards',
          severity: 'warning',
          title: `${offenders.length} rate card entrie(s) with no price`,
          description: `${offenders.length} RateCardEntry record(s) have null or zero Price. Either the entry was abandoned mid-setup, or it was intentional for a free tier — both deserve review.`,
          impact:
            'Usage events matching these entries will price at $0, leading to silent revenue leakage.',
          recommendation:
            'Set a positive Price on each entry, or document why $0 is intentional (e.g. free tier).',
          affected_records: offenders.slice(0, 25).map((e) => ({
            id: e.Id,
            name: cardNames[e.RateCardId] || e.RateCardId,
            type: 'RateCardEntry',
          })),
        },
      ];
    },
  },

  // ARM-023: Expired rate card still active
  {
    id: 'ARM-023',
    name: 'Expired Rate Card Still Active',
    category: 'arm_rate_cards',
    severity: 'info',
    description: 'RateCard with EffectiveEndDate in the past but IsActive=true',
    run: async (data: ARMData): Promise<Issue[]> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const offenders = data.rateCards.filter((rc) => {
        if (!rc.IsActive) return false;
        if (!rc.EffectiveEndDate) return false;
        return rc.EffectiveEndDate < todayIso;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-023',
          category: 'arm_rate_cards',
          severity: 'info',
          title: `${offenders.length} rate card(s) past end date but active`,
          description: `${offenders.length} active RateCard(s) have an EffectiveEndDate before today. They remain in the org but won't apply to new transactions.`,
          impact:
            'Low — pricing flows respect the date filter, but the active list grows over time.',
          recommendation:
            'Mark expired rate cards inactive, or extend their EffectiveEndDate if they should still apply.',
          affected_records: offenders.slice(0, 25).map((rc) => ({
            id: rc.Id,
            name: `${rc.Name} (ended ${rc.EffectiveEndDate})`,
            type: 'RateCard',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // ATTRIBUTES  (arm_attributes) — 3 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-024: Picklist AttributeDefinition with no values
  {
    id: 'ARM-024',
    name: 'Picklist Attribute Without Values',
    category: 'arm_attributes',
    severity: 'critical',
    description:
      'AttributeDefinition with DataType=Picklist but no AttributePicklistValue rows',
    run: async (data: ARMData): Promise<Issue[]> => {
      const valuesByAttr: Record<string, number> = {};
      for (const v of data.attributePicklistValues) {
        if (!v.AttributeDefinitionId) continue;
        valuesByAttr[v.AttributeDefinitionId] =
          (valuesByAttr[v.AttributeDefinitionId] || 0) + 1;
      }
      const offenders = data.attributeDefinitions.filter((ad) => {
        if (ad.IsActive === false) return false;
        const dt = (ad.DataType || '').toLowerCase();
        if (!dt.includes('picklist')) return false;
        return !valuesByAttr[ad.Id];
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-024',
          category: 'arm_attributes',
          severity: 'critical',
          title: `${offenders.length} picklist attribute(s) with no values`,
          description: `${offenders.length} AttributeDefinition record(s) of type Picklist have no AttributePicklistValue rows. Sales reps will see an empty dropdown — they cannot complete configuration. Examples: ${offenders.slice(0, 3).map((ad) => `"${ad.Name}"`).join(', ')}.`,
          impact:
            'Configurator hard-blocks on these attributes — quotes referencing them cannot be saved.',
          recommendation:
            'Add at least one AttributePicklistValue row per picklist attribute, or change the DataType.',
          affected_records: offenders.slice(0, 25).map((ad) => ({
            id: ad.Id,
            name: `${ad.Name} (${ad.Code})`,
            type: 'AttributeDefinition',
          })),
        },
      ];
    },
  },

  // ARM-025: Required AttributeDefinition without default value
  {
    id: 'ARM-025',
    name: 'Required Attribute Without Default Value',
    category: 'arm_attributes',
    severity: 'warning',
    description:
      'AttributeDefinition flagged required but with no DefaultValue',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.attributeDefinitions.filter((ad) => {
        if (ad.IsActive === false) return false;
        if (!ad.IsRequired) return false;
        return !ad.DefaultValue;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-025',
          category: 'arm_attributes',
          severity: 'warning',
          title: `${offenders.length} required attribute(s) without a default`,
          description: `${offenders.length} required AttributeDefinition record(s) have no DefaultValue. Sales reps must fill these in for every quote, slowing configuration. Examples: ${offenders.slice(0, 3).map((ad) => `"${ad.Name}"`).join(', ')}.`,
          impact:
            'UX friction during configuration, and quote save errors when the attribute is overlooked.',
          recommendation:
            'Set a sensible DefaultValue for each required attribute. If there is no sensible default, consider whether the attribute really needs to be required.',
          affected_records: offenders.slice(0, 25).map((ad) => ({
            id: ad.Id,
            name: `${ad.Name} (${ad.Code})`,
            type: 'AttributeDefinition',
          })),
        },
      ];
    },
  },

  // ARM-026: Inactive AttributeCategory with active AttributeDefinitions
  {
    id: 'ARM-026',
    name: 'Active Attributes In Inactive Category',
    category: 'arm_attributes',
    severity: 'warning',
    description:
      'AttributeDefinition records that point to an inactive AttributeCategory',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactiveCategoryIds = new Set(
        data.attributeCategories
          .filter((c) => c.IsActive === false)
          .map((c) => c.Id)
      );
      if (inactiveCategoryIds.size === 0) return [];
      const offenders = data.attributeDefinitions.filter(
        (ad) =>
          ad.IsActive !== false &&
          ad.AttributeCategoryId &&
          inactiveCategoryIds.has(ad.AttributeCategoryId)
      );
      if (offenders.length === 0) return [];
      const categoryNames: Record<string, string> = {};
      for (const c of data.attributeCategories) categoryNames[c.Id] = c.Name;
      return [
        {
          check_id: 'ARM-026',
          category: 'arm_attributes',
          severity: 'warning',
          title: `${offenders.length} active attribute(s) in inactive categor${offenders.length === 1 ? 'y' : 'ies'}`,
          description: `${offenders.length} active AttributeDefinition record(s) belong to an inactive AttributeCategory. Catalog UIs that group attributes by category will hide these.`,
          impact:
            'Attributes still apply at runtime but are invisible in admin views grouped by category — easy to lose track of.',
          recommendation:
            'Either reactivate the parent category, or move these attributes to an active category.',
          affected_records: offenders.slice(0, 25).map((ad) => ({
            id: ad.Id,
            name: `${ad.Name} → ${categoryNames[ad.AttributeCategoryId!] || 'inactive category'}`,
            type: 'AttributeDefinition',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // FILL-INS for sparse existing categories
  // ═════════════════════════════════════════════════════════════════

  // ARM-027: Multiple active pricing procedures (only one should typically be primary)
  {
    id: 'ARM-027',
    name: 'Multiple Active Pricing Procedures',
    category: 'arm_pricing_procedures',
    severity: 'info',
    description:
      'More than one PricingProcedure is defined — usually only one is primary',
    run: async (data: ARMData): Promise<Issue[]> => {
      // ExpressionSet at v66 doesn't expose IsActive — published procedures
      // are simply present in the result set. Multiple procedures with the
      // same UsageType is the drift signal.
      const pricing = data.pricingProcedures.filter((p) => p.UsageType === 'Pricing');
      if (pricing.length <= 1) return [];
      return [
        {
          check_id: 'ARM-027',
          category: 'arm_pricing_procedures',
          severity: 'info',
          title: `${pricing.length} pricing procedures defined`,
          description: `${pricing.length} ExpressionSet records with UsageType=Pricing exist simultaneously: ${pricing.slice(0, 5).map((p) => `"${p.ApiName}"`).join(', ')}${pricing.length > 5 ? `, +${pricing.length - 5} more` : ''}. Most orgs operate with a single primary procedure plus a small number of overrides — having many suggests configuration drift.`,
          impact:
            'Pricing rule resolution becomes harder to reason about, especially when multiple procedures could match the same quote line.',
          recommendation:
            'Audit each pricing procedure. Retire any no longer needed, or document why each one needs to stay.',
          affected_records: pricing.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.ApiName,
            type: 'PricingProcedure',
          })),
        },
      ];
    },
  },

  // ARM-028: Standard pricebook is inactive
  {
    id: 'ARM-028',
    name: 'Standard Pricebook Is Inactive',
    category: 'arm_price_books',
    severity: 'critical',
    description: 'The standard Pricebook2 is flagged inactive',
    run: async (data: ARMData): Promise<Issue[]> => {
      const std = data.priceBooks.find((pb) => pb.IsStandard);
      if (!std || std.IsActive) return [];
      return [
        {
          check_id: 'ARM-028',
          category: 'arm_price_books',
          severity: 'critical',
          title: 'Standard pricebook is inactive',
          description: `The standard Pricebook2 ("${std.Name}") is marked inactive. Salesforce relies on this object for many baseline pricing flows.`,
          impact:
            'Several Revenue Cloud and CPQ flows assume the standard pricebook is active — disabling it can cause unpredictable failures.',
          recommendation:
            'Reactivate the standard pricebook unless you have a strong, documented reason to keep it disabled.',
          affected_records: [
            {
              id: std.Id,
              name: std.Name,
              type: 'Pricebook2',
            },
          ],
        },
      ];
    },
  },

  // ARM-029: All decision tables are in Draft
  {
    id: 'ARM-029',
    name: 'All Decision Tables Are Draft',
    category: 'arm_decision_tables',
    severity: 'warning',
    description:
      'No active decision tables — Business Rules Engine evaluation will be a no-op',
    run: async (data: ARMData): Promise<Issue[]> => {
      if (data.decisionTables.length === 0) return [];
      const active = data.decisionTables.filter(
        (d) => (d.Status || '').toLowerCase() === 'active'
      );
      if (active.length > 0) return [];
      return [
        {
          check_id: 'ARM-029',
          category: 'arm_decision_tables',
          severity: 'warning',
          title: `${data.decisionTables.length} decision table(s) — none active`,
          description: `${data.decisionTables.length} DecisionTable record(s) exist but none are in Active status. Any flow that depends on them will silently produce no result.`,
          impact:
            'Pricing/qualification rules driven by these tables will not run. Quotes look "clean" but business logic is bypassed.',
          recommendation:
            'Activate at least one decision table per logical use case, or remove the abandoned ones.',
          affected_records: data.decisionTables.slice(0, 25).map((d) => ({
            id: d.Id,
            name: `${d.MasterLabel} (${d.Status})`,
            type: 'DecisionTable',
          })),
        },
      ];
    },
  },

  // ARM-030: All context definitions inactive
  {
    id: 'ARM-030',
    name: 'No Active Context Definitions',
    category: 'arm_context_service',
    severity: 'warning',
    description:
      'Context Service has zero active definitions — qualification rules cannot resolve context',
    run: async (data: ARMData): Promise<Issue[]> => {
      if (data.contextDefinitions.length === 0) return [];
      const active = data.contextDefinitions.filter((c) => c.IsActive);
      if (active.length > 0) return [];
      return [
        {
          check_id: 'ARM-030',
          category: 'arm_context_service',
          severity: 'warning',
          title: `${data.contextDefinitions.length} context definition(s) — none active`,
          description: `Your org has ${data.contextDefinitions.length} ContextDefinition record(s), but none are active. Qualification rules and expression sets that read context (e.g. customer tier, region, channel) will fail to resolve any value.`,
          impact:
            'Decision tables and expression sets depending on context attributes cannot evaluate correctly.',
          recommendation:
            'Activate the relevant context definition for each consumer, or build/import one if your org has not been initialised with one.',
          affected_records: data.contextDefinitions.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.DeveloperName,
            type: 'ContextDefinition',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // ASSETS  (arm_assets) — 5 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-031: Active asset without any state period
  {
    id: 'ARM-031',
    name: 'Active Asset Without State Period',
    category: 'arm_assets',
    severity: 'warning',
    description:
      'Assets in an active status but with no AssetStatePeriod history',
    run: async (data: ARMData): Promise<Issue[]> => {
      const periodsByAsset = new Set(data.assetStatePeriods.map((p) => p.AssetId));
      const offenders = data.assets.filter((a) => {
        const status = (a.Status || '').toLowerCase();
        if (status !== 'active' && status !== 'shipped' && status !== 'installed') {
          return false;
        }
        return !periodsByAsset.has(a.Id);
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-031',
          category: 'arm_assets',
          severity: 'warning',
          title: `${offenders.length} active asset(s) without state period history`,
          description: `${offenders.length} active Asset record(s) have no AssetStatePeriod row. Without state history the lifecycle dashboard, MRR, and current quantity fields will show zero or empty values.`,
          impact:
            'Reporting and renewals on these assets will be inaccurate.',
          recommendation:
            'Generate the missing AssetStatePeriod records via the standard asset action flow, or via the Customer Asset Lifecycle Management API.',
          affected_records: offenders.slice(0, 25).map((a) => ({
            id: a.Id,
            name: a.Name,
            type: 'Asset',
          })),
        },
      ];
    },
  },

  // ARM-032: Asset with end date in the past but still active
  {
    id: 'ARM-032',
    name: 'Asset Past End Date Still Active',
    category: 'arm_assets',
    severity: 'info',
    description:
      'Asset with CurrentLifecycleEndDate in the past but Status=Active',
    run: async (data: ARMData): Promise<Issue[]> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const offenders = data.assets.filter((a) => {
        const status = (a.Status || '').toLowerCase();
        if (status !== 'active') return false;
        if (!a.CurrentLifecycleEndDate) return false;
        return a.CurrentLifecycleEndDate < todayIso;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-032',
          category: 'arm_assets',
          severity: 'info',
          title: `${offenders.length} asset(s) past their end date`,
          description: `${offenders.length} active Asset record(s) have a CurrentLifecycleEndDate in the past. They should typically have transitioned to Cancelled, Expired, or similar.`,
          impact:
            'MRR and active counts may be inflated. Renewal opportunities may be missed if the asset is silently abandoned.',
          recommendation:
            'Run an asset action to transition them to the correct end-of-life state, or extend the end date if they are still in use.',
          affected_records: offenders.slice(0, 25).map((a) => ({
            id: a.Id,
            name: `${a.Name} (ended ${a.CurrentLifecycleEndDate})`,
            type: 'Asset',
          })),
        },
      ];
    },
  },

  // ARM-033: Asset relationship pointing to a missing/inactive related asset
  {
    id: 'ARM-033',
    name: 'Orphan Asset Relationship',
    category: 'arm_assets',
    severity: 'warning',
    description:
      'AssetRelationship rows whose RelatedAssetId points to an asset that is missing or inactive',
    run: async (data: ARMData): Promise<Issue[]> => {
      const assetById: Record<string, RLMAsset | undefined> = {};
      for (const a of data.assets) assetById[a.Id] = a;
      const offenders = data.assetRelationships.filter((r) => {
        if (!r.RelatedAssetId) return true; // null pointer
        const target = assetById[r.RelatedAssetId];
        if (!target) return true; // related asset not in result set
        const status = (target.Status || '').toLowerCase();
        return status === 'cancelled' || status === 'expired';
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-033',
          category: 'arm_assets',
          severity: 'warning',
          title: `${offenders.length} asset relationship(s) point at missing or expired assets`,
          description: `${offenders.length} AssetRelationship record(s) reference a related asset that is missing, cancelled, or expired. Hierarchy reports and amendment flows that walk the relationship tree will hit dead ends.`,
          impact:
            'Lifecycle queries and amendment flows produce incomplete data; some renewals may be hidden.',
          recommendation:
            'Either delete the stale AssetRelationship row, or repoint it at the active replacement asset.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: `${r.AssetId} → ${r.RelatedAssetId || 'NULL'} (${r.RelationshipType || 'Unknown'})`,
            type: 'AssetRelationship',
          })),
        },
      ];
    },
  },

  // ARM-034: Multiple "current" state periods on same asset (data integrity)
  {
    id: 'ARM-034',
    name: 'Multiple Current Asset State Periods',
    category: 'arm_assets',
    severity: 'critical',
    description:
      'Asset has more than one AssetStatePeriod flagged IsCurrent=true (only one should be current)',
    run: async (data: ARMData): Promise<Issue[]> => {
      const currentByAsset: Record<string, number> = {};
      for (const p of data.assetStatePeriods) {
        if (!p.IsCurrent) continue;
        currentByAsset[p.AssetId] = (currentByAsset[p.AssetId] || 0) + 1;
      }
      const offenderAssetIds = Object.entries(currentByAsset)
        .filter(([, count]) => count > 1)
        .map(([id]) => id);
      if (offenderAssetIds.length === 0) return [];
      const assetName: Record<string, string> = {};
      for (const a of data.assets) assetName[a.Id] = a.Name;
      return [
        {
          check_id: 'ARM-034',
          category: 'arm_assets',
          severity: 'critical',
          title: `${offenderAssetIds.length} asset(s) with multiple current state periods`,
          description: `${offenderAssetIds.length} Asset(s) have more than one AssetStatePeriod marked IsCurrent=true. The asset record's MRR and Quantity fields are derived from "the" current period — having multiple breaks that derivation.`,
          impact:
            'MRR, current quantity, and lifecycle dashboards will report unstable values for these assets.',
          recommendation:
            'Investigate the asset action history. Set IsCurrent=false on all but the single most recent period.',
          affected_records: offenderAssetIds.slice(0, 25).map((id) => ({
            id,
            name: `${assetName[id] || id} (${currentByAsset[id]} current periods)`,
            type: 'Asset',
          })),
        },
      ];
    },
  },

  // ARM-035: Asset state period with zero / null quantity
  {
    id: 'ARM-035',
    name: 'Asset State Period With Zero Quantity',
    category: 'arm_assets',
    severity: 'info',
    description:
      'Current AssetStatePeriod with Quantity null or zero — likely incomplete data',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.assetStatePeriods.filter(
        (p) => p.IsCurrent && (p.Quantity == null || p.Quantity === 0)
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-035',
          category: 'arm_assets',
          severity: 'info',
          title: `${offenders.length} current state period(s) with zero/null quantity`,
          description: `${offenders.length} current AssetStatePeriod(s) have Quantity null or zero. Usage, MRR, and renewal projections derived from the period will report zero.`,
          impact:
            'Skews aggregate revenue/usage numbers downward.',
          recommendation:
            'Backfill the quantity from the source order, or generate a corrective asset action.',
          affected_records: offenders.slice(0, 25).map((p) => ({
            id: p.Id,
            name: `Asset ${p.AssetId} (${p.StartDate || '?'} → ${p.EndDate || '?'})`,
            type: 'AssetStatePeriod',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // CONTRACTS  (arm_contracts) — 4 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-036: ContractItemPrice without effective dates
  {
    id: 'ARM-036',
    name: 'Contract Item Price Without Effective Dates',
    category: 'arm_contracts',
    severity: 'warning',
    description:
      'ContractItemPrice records missing both EffectiveStartDate and EffectiveEndDate',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.contractItemPrices.filter(
        (p) => !p.EffectiveStartDate && !p.EffectiveEndDate
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-036',
          category: 'arm_contracts',
          severity: 'warning',
          title: `${offenders.length} contract price(s) without effective dates`,
          description: `${offenders.length} ContractItemPrice record(s) have neither an EffectiveStartDate nor an EffectiveEndDate. Without dating, the price applies indefinitely — including to amendments and renewals where it shouldn't.`,
          impact:
            'Amendments may pull stale contract prices into new quotes silently.',
          recommendation:
            'Add at least an EffectiveStartDate to every ContractItemPrice, plus an EffectiveEndDate aligned with the contract end where applicable.',
          affected_records: offenders.slice(0, 25).map((p) => ({
            id: p.Id,
            name: `Product ${p.Product2Id || '?'} on Contract ${p.ContractId || '?'}`,
            type: 'ContractItemPrice',
          })),
        },
      ];
    },
  },

  // ARM-037: Active contract with end date in past
  {
    id: 'ARM-037',
    name: 'Active Contract Past End Date',
    category: 'arm_contracts',
    severity: 'info',
    description:
      'Contract in Activated status with EndDate before today',
    run: async (data: ARMData): Promise<Issue[]> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const offenders = data.contracts.filter((c) => {
        const status = (c.Status || '').toLowerCase();
        if (status !== 'activated' && status !== 'active') return false;
        if (!c.EndDate) return false;
        return c.EndDate < todayIso;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-037',
          category: 'arm_contracts',
          severity: 'info',
          title: `${offenders.length} contract(s) past end date but still active`,
          description: `${offenders.length} Contract record(s) are in Activated status with an EndDate before today. They should typically have moved to Expired.`,
          impact:
            'Renewal pipelines often filter on Status — expired-but-active contracts get missed.',
          recommendation:
            'Run a Contract Status batch to transition past-due contracts to Expired, or extend the EndDate if they were renewed offline.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: `Contract ${c.Id} (ended ${c.EndDate})`,
            type: 'Contract',
          })),
        },
      ];
    },
  },

  // ARM-038: ContractItemPrice with negative or zero price
  {
    id: 'ARM-038',
    name: 'Contract Item Price Is Zero Or Negative',
    category: 'arm_contracts',
    severity: 'warning',
    description:
      'ContractItemPrice rows where Price is null, zero, or negative',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.contractItemPrices.filter(
        (p) => p.Price == null || p.Price <= 0
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-038',
          category: 'arm_contracts',
          severity: 'warning',
          title: `${offenders.length} contract price(s) at zero or negative`,
          description: `${offenders.length} ContractItemPrice record(s) have Price null, zero, or negative. When amendments pull contract pricing, these will lock in giveaway pricing.`,
          impact:
            'Revenue leakage on amendments — products effectively given away or refunded.',
          recommendation:
            'Audit each row. Some may be intentional (free trial conversions, credit lines) but most are likely data errors that need correction.',
          affected_records: offenders.slice(0, 25).map((p) => ({
            id: p.Id,
            name: `Product ${p.Product2Id || '?'} @ ${p.Price ?? 'null'}`,
            type: 'ContractItemPrice',
          })),
        },
      ];
    },
  },

  // ARM-039: Contract with reversed dates (start > end)
  {
    id: 'ARM-039',
    name: 'Contract With Reversed Dates',
    category: 'arm_contracts',
    severity: 'critical',
    description:
      'Contract where StartDate is later than EndDate',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.contracts.filter(
        (c) => c.StartDate && c.EndDate && c.StartDate > c.EndDate
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-039',
          category: 'arm_contracts',
          severity: 'critical',
          title: `${offenders.length} contract(s) with start date after end date`,
          description: `${offenders.length} Contract record(s) have StartDate later than EndDate. This is a hard data integrity error — the contract has a negative duration.`,
          impact:
            'Subscription quantity calculations, renewals, and asset state period generation will all behave unpredictably.',
          recommendation:
            'Identify the correct dates and fix them. If the contract was misentered, re-create it from the source order.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: `Contract ${c.Id} (${c.StartDate} → ${c.EndDate})`,
            type: 'Contract',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // USAGE MANAGEMENT  (arm_usage_management) — 5 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-040: UnitOfMeasureClass without default UoM
  {
    id: 'ARM-040',
    name: 'Unit Of Measure Class Without Default UoM',
    category: 'arm_usage_management',
    severity: 'warning',
    description:
      'UnitOfMeasureClass record missing DefaultUomId',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.unitOfMeasureClasses.filter(
        (c) => c.IsActive !== false && !c.DefaultUomId
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-040',
          category: 'arm_usage_management',
          severity: 'warning',
          title: `${offenders.length} UoM class(es) without a default unit`,
          description: `${offenders.length} active UnitOfMeasureClass record(s) have no DefaultUomId. Conversions between units in the class will fail without a reference unit.`,
          impact:
            'Usage rating may compute zero or error out when converting between units.',
          recommendation:
            'Set a DefaultUomId on each class — typically the smallest unit in the class.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.Id,
            type: 'UnitOfMeasureClass',
          })),
        },
      ];
    },
  },

  // ARM-041: UsageResource not in Active status
  {
    id: 'ARM-041',
    name: 'Usage Resource Not Active',
    category: 'arm_usage_management',
    severity: 'warning',
    description:
      'UsageResource records that are Draft or Inactive — RLM doc requires Active status before use',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.usageResources.filter(
        (r) => (r.Status || '').toLowerCase() !== 'active'
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-041',
          category: 'arm_usage_management',
          severity: 'warning',
          title: `${offenders.length} usage resource(s) not active`,
          description: `${offenders.length} UsageResource record(s) are not in Active status. Per the RLM dev guide: "selling and consumption-related object records such as UnitOfMeasureClass, UsageResource, RateCardEntry must be active before you use it."`,
          impact:
            'Products tied to these resources will not rate usage events correctly.',
          recommendation:
            'Activate the resources you intend to use, and delete drafts that are no longer needed.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: `${r.Name || r.Id} (${r.Status})`,
            type: 'UsageResource',
          })),
        },
      ];
    },
  },

  // ARM-042: ProductUsageGrant past end date but still active
  {
    id: 'ARM-042',
    name: 'Expired Product Usage Grant Still Active',
    category: 'arm_usage_management',
    severity: 'info',
    description:
      'ProductUsageGrant with EffectiveEndDate in the past but Status=Active',
    run: async (data: ARMData): Promise<Issue[]> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const offenders = data.productUsageGrants.filter((g) => {
        if ((g.Status || '').toLowerCase() !== 'active') return false;
        if (!g.EffectiveEndDate) return false;
        return g.EffectiveEndDate < todayIso;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-042',
          category: 'arm_usage_management',
          severity: 'info',
          title: `${offenders.length} usage grant(s) past end date but active`,
          description: `${offenders.length} ProductUsageGrant record(s) are still flagged Active despite having an EffectiveEndDate before today.`,
          impact:
            'Cleanup task — grants no longer apply, but the active list grows over time.',
          recommendation:
            'Per the RLM dev guide, you can extend EffectiveEndDate on Active grants but you cannot edit other fields. Either extend, or transition them to Inactive via the supported status path.',
          affected_records: offenders.slice(0, 25).map((g) => ({
            id: g.Id,
            name: `${g.Name || g.Id} (ended ${g.EffectiveEndDate})`,
            type: 'ProductUsageGrant',
          })),
        },
      ];
    },
  },

  // ARM-043: ProductUsageGrant with reversed dates
  {
    id: 'ARM-043',
    name: 'Usage Grant With Reversed Dates',
    category: 'arm_usage_management',
    severity: 'critical',
    description:
      'ProductUsageGrant with EffectiveStartDate after EffectiveEndDate',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.productUsageGrants.filter(
        (g) =>
          g.EffectiveStartDate &&
          g.EffectiveEndDate &&
          g.EffectiveStartDate > g.EffectiveEndDate
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-043',
          category: 'arm_usage_management',
          severity: 'critical',
          title: `${offenders.length} usage grant(s) with reversed dates`,
          description: `${offenders.length} ProductUsageGrant record(s) have EffectiveStartDate later than EffectiveEndDate. The grant covers a negative period and effectively never applies.`,
          impact:
            'Customers entitled to these grants will not actually receive coverage during what should be the entitlement window.',
          recommendation:
            'Fix the date ordering or recreate the grant with correct values. Note: Active grants can only have their end date extended, so you may need to deactivate first.',
          affected_records: offenders.slice(0, 25).map((g) => ({
            id: g.Id,
            name: `${g.Name || g.Id} (${g.EffectiveStartDate} → ${g.EffectiveEndDate})`,
            type: 'ProductUsageGrant',
          })),
        },
      ];
    },
  },

  // ARM-044: UsageResource without UnitOfMeasureClass
  {
    id: 'ARM-044',
    name: 'Usage Resource Missing Unit Of Measure Class',
    category: 'arm_usage_management',
    severity: 'warning',
    description:
      'UsageResource records with no UnitOfMeasureClassId',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.usageResources.filter(
        (r) => !r.UnitOfMeasureClassId && (r.Status || '').toLowerCase() === 'active'
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-044',
          category: 'arm_usage_management',
          severity: 'warning',
          title: `${offenders.length} active usage resource(s) without a UoM class`,
          description: `${offenders.length} active UsageResource record(s) have no UnitOfMeasureClassId. Without a UoM class, the engine cannot validate or convert incoming usage events.`,
          impact:
            'Usage events will be rejected or misrated.',
          recommendation:
            'Assign each UsageResource to the appropriate UnitOfMeasureClass.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || r.Id,
            type: 'UsageResource',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // ORCHESTRATION (DRO)  (arm_orchestration) — 4 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-045: FulfillmentStepDefinition without group
  {
    id: 'ARM-045',
    name: 'Fulfillment Step Without Group',
    category: 'arm_orchestration',
    severity: 'warning',
    description:
      'FulfillmentStepDefinition records not assigned to a FulfillmentStepDefinitionGroup',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.fulfillmentStepDefinitions.filter(
        (s) => !s.FulfillmentStepDefinitionGroupId
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-045',
          category: 'arm_orchestration',
          severity: 'warning',
          title: `${offenders.length} fulfillment step(s) not assigned to a group`,
          description: `${offenders.length} FulfillmentStepDefinition record(s) have no FulfillmentStepDefinitionGroupId. The step won't participate in any scenario evaluation.`,
          impact:
            'Orchestrated processes silently skip these steps — fulfillment may proceed without them.',
          recommendation:
            'Assign each step to the appropriate FulfillmentStepDefinitionGroup, or remove orphan steps that are no longer needed.',
          affected_records: offenders.slice(0, 25).map((s) => ({
            id: s.Id,
            name: s.Name || s.Id,
            type: 'FulfillmentStepDefinition',
          })),
        },
      ];
    },
  },

  // ARM-046: FulfillmentStepDefinitionGroup with no steps
  {
    id: 'ARM-046',
    name: 'Empty Fulfillment Step Group',
    category: 'arm_orchestration',
    severity: 'info',
    description:
      'FulfillmentStepDefinitionGroup records that have no steps assigned',
    run: async (data: ARMData): Promise<Issue[]> => {
      const stepsByGroup: Record<string, number> = {};
      for (const s of data.fulfillmentStepDefinitions) {
        if (!s.FulfillmentStepDefinitionGroupId) continue;
        stepsByGroup[s.FulfillmentStepDefinitionGroupId] =
          (stepsByGroup[s.FulfillmentStepDefinitionGroupId] || 0) + 1;
      }
      const empties = data.fulfillmentStepDefinitionGroups.filter(
        (g) => !stepsByGroup[g.Id]
      );
      if (empties.length === 0) return [];
      return [
        {
          check_id: 'ARM-046',
          category: 'arm_orchestration',
          severity: 'info',
          title: `${empties.length} empty fulfillment step group(s)`,
          description: `${empties.length} FulfillmentStepDefinitionGroup record(s) have zero steps assigned. The group is dead configuration.`,
          impact:
            'No runtime impact, but adds noise during audit.',
          recommendation:
            'Either populate the group with steps, or delete the obsolete group.',
          affected_records: empties.slice(0, 25).map((g) => ({
            id: g.Id,
            name: g.Name || g.Id,
            type: 'FulfillmentStepDefinitionGroup',
          })),
        },
      ];
    },
  },

  // ARM-047: FulfillmentTaskAssignmentRule without owner
  {
    id: 'ARM-047',
    name: 'Fulfillment Task Rule Without Assignee',
    category: 'arm_orchestration',
    severity: 'warning',
    description:
      'FulfillmentTaskAssignmentRule records that have no AssignedToId set',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.fulfillmentTaskAssignmentRules.filter(
        (r) => (r.Status || '').toLowerCase() === 'active' && !r.AssignedToId
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-047',
          category: 'arm_orchestration',
          severity: 'warning',
          title: `${offenders.length} task assignment rule(s) with no assignee`,
          description: `${offenders.length} active FulfillmentTaskAssignmentRule record(s) have no AssignedToId. Generated tasks will have no owner and may sit unhandled.`,
          impact:
            'Orchestrated tasks pile up without an owner — fulfillment SLAs slip.',
          recommendation:
            'Assign each active rule to a User or Queue.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || r.Id,
            type: 'FulfillmentTaskAssignmentRule',
          })),
        },
      ];
    },
  },

  // ARM-048: ProductFulfillmentScenario not Active
  {
    id: 'ARM-048',
    name: 'Inactive Product Fulfillment Scenario',
    category: 'arm_orchestration',
    severity: 'warning',
    description:
      'ProductFulfillmentScenario records that are not in Active status',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.productFulfillmentScenarios.filter(
        (s) => (s.Status || '').toLowerCase() !== 'active'
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-048',
          category: 'arm_orchestration',
          severity: 'warning',
          title: `${offenders.length} fulfillment scenario(s) not active`,
          description: `${offenders.length} ProductFulfillmentScenario record(s) are not in Active status. Orders matching these scenarios won't trigger orchestration.`,
          impact:
            'Order fulfillment may complete without the intended steps running.',
          recommendation:
            'Activate scenarios you intend to use, or delete drafts that are no longer needed.',
          affected_records: offenders.slice(0, 25).map((s) => ({
            id: s.Id,
            name: `${s.Name || s.Id} (${s.Status})`,
            type: 'ProductFulfillmentScenario',
          })),
        },
      ];
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // COST BOOKS  (arm_cost_books) — 3 checks
  // ═════════════════════════════════════════════════════════════════

  // ARM-049: Active CostBook with no entries
  {
    id: 'ARM-049',
    name: 'Active Cost Book With No Entries',
    category: 'arm_cost_books',
    severity: 'warning',
    description:
      'CostBook is active but has no CostBookEntry rows',
    run: async (data: ARMData): Promise<Issue[]> => {
      const entriesByBook: Record<string, number> = {};
      for (const e of data.costBookEntries) {
        entriesByBook[e.CostBookId] = (entriesByBook[e.CostBookId] || 0) + 1;
      }
      const empties = data.costBooks.filter(
        (cb) => cb.IsActive !== false && !entriesByBook[cb.Id]
      );
      if (empties.length === 0) return [];
      return [
        {
          check_id: 'ARM-049',
          category: 'arm_cost_books',
          severity: 'warning',
          title: `${empties.length} active cost book(s) with no entries`,
          description: `${empties.length} active CostBook(s) have zero CostBookEntry rows. Margin and profitability calculations referencing them will fall back to defaults.`,
          impact:
            'Margin reports show zero or default values for products tied to these cost books.',
          recommendation:
            'Populate each CostBook with entries, or deactivate the empty book.',
          affected_records: empties.slice(0, 25).map((cb) => ({
            id: cb.Id,
            name: cb.Name,
            type: 'CostBook',
          })),
        },
      ];
    },
  },

  // ARM-050: CostBookEntry with zero or null cost
  {
    id: 'ARM-050',
    name: 'Cost Book Entry With No Cost',
    category: 'arm_cost_books',
    severity: 'info',
    description:
      'CostBookEntry rows with Cost null or zero',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.costBookEntries.filter(
        (e) => e.Cost == null || e.Cost === 0
      );
      if (offenders.length === 0) return [];
      const bookNames: Record<string, string> = {};
      for (const cb of data.costBooks) bookNames[cb.Id] = cb.Name;
      return [
        {
          check_id: 'ARM-050',
          category: 'arm_cost_books',
          severity: 'info',
          title: `${offenders.length} cost book entries with zero / null cost`,
          description: `${offenders.length} CostBookEntry record(s) have Cost null or zero. Margin will show 100% on the associated products — accurate only if those are genuinely zero-cost items.`,
          impact:
            'Margin reports may overstate profitability.',
          recommendation:
            'Backfill the actual cost for each entry, or document which products are intentionally zero-cost.',
          affected_records: offenders.slice(0, 25).map((e) => ({
            id: e.Id,
            name: `${bookNames[e.CostBookId] || e.CostBookId} → product ${e.Product2Id || '?'}`,
            type: 'CostBookEntry',
          })),
        },
      ];
    },
  },

  // ARM-051: Multiple active non-standard cost books per currency
  {
    id: 'ARM-051',
    name: 'Multiple Active Cost Books Per Currency',
    category: 'arm_cost_books',
    severity: 'info',
    description:
      'More than one active non-standard CostBook for the same currency',
    run: async (data: ARMData): Promise<Issue[]> => {
      const byCurrency: Record<string, RLMCostBook[]> = {};
      for (const cb of data.costBooks) {
        if (cb.IsActive === false) continue;
        if (cb.IsStandard) continue;
        const cur = cb.CurrencyIsoCode || 'NONE';
        if (!byCurrency[cur]) byCurrency[cur] = [];
        byCurrency[cur].push(cb);
      }
      const conflicts = Object.entries(byCurrency).filter(([, list]) => list.length > 1);
      if (conflicts.length === 0) return [];
      const all = conflicts.flatMap(([, list]) => list);
      return [
        {
          check_id: 'ARM-051',
          category: 'arm_cost_books',
          severity: 'info',
          title: `${conflicts.length} currenc${conflicts.length === 1 ? 'y' : 'ies'} with multiple active cost books`,
          description: `${conflicts.length} currenc${conflicts.length === 1 ? 'y has' : 'ies have'} more than one active non-standard CostBook. ${conflicts.map(([cur, list]) => `${cur}: ${list.map((cb) => `"${cb.Name}"`).join(', ')}`).slice(0, 3).join('; ')}.`,
          impact:
            'Without segmentation logic, margin calculations may pick whichever cost book the engine encounters first.',
          recommendation:
            'Document which cost book applies to which segment, or consolidate.',
          affected_records: all.slice(0, 25).map((cb) => ({
            id: cb.Id,
            name: cb.Name,
            type: 'CostBook',
          })),
        },
      ];
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // v5 checks (ARM-101 through ARM-214) — Spring '26 dev guide v66.0
  // 26 new checks across Pricing extensions, Product Qualification,
  // Ramp Deals, Fulfillment dependencies, Tax, Billing Policies,
  // General Ledger, and Contract Clauses.
  // ═══════════════════════════════════════════════════════════════════

  // ─── PRICING extensions (ARM-130 to ARM-133) ──────────────────────

  // ARM-130: Price Adjustment Tier Effective Range Outside Schedule
  // Doc: lines 3164-3166 — "EffectiveFrom and EffectiveTo of a price
  // adjustment tier must be within the EffectiveFrom and EffectiveTo of
  // the parent." Violations are silently dropped at resolution.
  {
    id: 'ARM-130',
    name: 'Price Adjustment Tier Outside Parent Schedule Date Range',
    category: 'arm_price_adjustments',
    severity: 'critical',
    description:
      'Tier effective dates fall outside the parent schedule\'s effective window — tier silently ignored at resolution',
    run: async (data: ARMData): Promise<Issue[]> => {
      // Schedule date fields aren't in our slim type; the underlying SOQL
      // does select them, so we cast through unknown to read them.
      const schedById = new Map(
        data.priceAdjustmentSchedules.map((s) => [s.Id, s as unknown as { Id: string; Name: string; EffectiveFrom?: string | null; EffectiveTo?: string | null }])
      );
      const offenders = data.priceAdjustmentTiers.filter((t) => {
        const ext = t as unknown as { PriceAdjustmentScheduleId?: string; EffectiveFrom?: string | null; EffectiveTo?: string | null };
        if (!ext.PriceAdjustmentScheduleId) return false;
        const parent = schedById.get(ext.PriceAdjustmentScheduleId);
        if (!parent) return false;
        if (!parent.EffectiveFrom && !parent.EffectiveTo) return false;
        if (ext.EffectiveFrom && parent.EffectiveFrom && ext.EffectiveFrom < parent.EffectiveFrom) return true;
        if (ext.EffectiveTo && parent.EffectiveTo && ext.EffectiveTo > parent.EffectiveTo) return true;
        return false;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-130',
          category: 'arm_price_adjustments',
          severity: 'critical',
          title: `${offenders.length} price adjustment tier(s) outside parent schedule date range`,
          description: `${offenders.length} PriceAdjustmentTier record(s) have effective dates that extend beyond their parent schedule's window. Salesforce silently ignores these tiers during price resolution — the discount you expect won't apply.`,
          impact: 'Quote prices skip the broken tiers, leading to unexpectedly high (or in some cases low) line prices that don\'t match the price book intent.',
          recommendation: 'Trim each tier\'s EffectiveFrom/EffectiveTo to fit within the parent PriceAdjustmentSchedule\'s window, or extend the parent\'s window if the tier dates are correct.',
          affected_records: offenders.slice(0, 25).map((t) => ({
            id: t.Id,
            name: `Tier ${t.Id.slice(-6)}`,
            type: 'PriceAdjustmentTier',
          })),
        },
      ];
    },
  },

  // ARM-131: Attribute-based Adjustment Outside Schedule Window
  // Doc: lines 3164-3166 — same constraint covers attribute-based and
  // bundle-based adjustments.
  {
    id: 'ARM-131',
    name: 'Attribute Adjustment Effective Window Outside Parent Schedule',
    category: 'arm_attribute_pricing',
    severity: 'critical',
    description:
      'AttributeBasedAdjRule effective dates fall outside the parent PriceAdjustmentSchedule window',
    run: async (data: ARMData): Promise<Issue[]> => {
      const schedById = new Map(
        data.priceAdjustmentSchedules.map((s) => [s.Id, s as unknown as { Id: string; EffectiveFrom?: string | null; EffectiveTo?: string | null }])
      );
      const offenders = data.attributeBasedAdjRules.filter((r) => {
        const ext = r as unknown as { PriceAdjustmentScheduleId?: string | null; EffectiveStartDate?: string | null; EffectiveEndDate?: string | null };
        if (!ext.PriceAdjustmentScheduleId) return false;
        const parent = schedById.get(ext.PriceAdjustmentScheduleId);
        if (!parent) return false;
        if (ext.EffectiveStartDate && parent.EffectiveFrom && ext.EffectiveStartDate < parent.EffectiveFrom) return true;
        if (ext.EffectiveEndDate && parent.EffectiveTo && ext.EffectiveEndDate > parent.EffectiveTo) return true;
        return false;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-131',
          category: 'arm_attribute_pricing',
          severity: 'critical',
          title: `${offenders.length} attribute adjustment(s) extend outside parent schedule window`,
          description: `${offenders.length} AttributeBasedAdjRule record(s) have effective dates outside their parent PriceAdjustmentSchedule\'s window. The rule won\'t fire for the orphan portion of the date range.`,
          impact: 'Attribute-driven discounts silently no-op for portions of the calendar, producing inconsistent pricing across orders.',
          recommendation: 'Align EffectiveStartDate/EffectiveEndDate to fit inside the parent schedule\'s EffectiveFrom/EffectiveTo.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || `Rule ${r.Id.slice(-6)}`,
            type: 'AttributeBasedAdjRule',
          })),
        },
      ];
    },
  },

  // ARM-132: PricebookEntry has ProductSellingModelId but no PSMO link
  // Doc: line 3167 — "Product and product selling model must be a part
  // of the product selling model option before you create values in a
  // price book entry." Orphan PBEs return no list price.
  {
    id: 'ARM-132',
    name: 'Pricebook Entry Without Matching Selling Model Option',
    category: 'arm_price_books',
    severity: 'critical',
    description:
      'PricebookEntry references a ProductSellingModel without a matching ProductSellingModelOption — list price won\'t resolve',
    run: async (data: ARMData): Promise<Issue[]> => {
      const psmoKeys = new Set(
        data.sellingModelOptions
          .filter((o) => o.IsActive !== false)
          .map((o) => `${o.Product2Id}|${o.ProductSellingModelId}`)
      );
      const orphans = data.pricebookEntries.filter((pbe) => {
        if (!pbe.ProductSellingModelId) return false;
        if (pbe.IsActive === false) return false;
        const key = `${pbe.Product2Id}|${pbe.ProductSellingModelId}`;
        return !psmoKeys.has(key);
      });
      if (orphans.length === 0) return [];
      return [
        {
          check_id: 'ARM-132',
          category: 'arm_price_books',
          severity: 'critical',
          title: `${orphans.length} pricebook entry(s) reference selling models without matching options`,
          description: `${orphans.length} active PricebookEntry record(s) reference a ProductSellingModel but the (Product, SellingModel) pair has no active ProductSellingModelOption. Salesforce won\'t return a list price for these combinations.`,
          impact: 'Quote configurator returns "no price found" or falls back to zero on these products, blocking sales reps mid-flow.',
          recommendation: 'Either add a ProductSellingModelOption row for each (Product2, ProductSellingModel) pair, or remove the ProductSellingModelId from the PricebookEntry if the option isn\'t needed.',
          affected_records: orphans.slice(0, 25).map((pbe) => ({
            id: pbe.Id,
            name: `PBE ${pbe.Id.slice(-6)}`,
            type: 'PricebookEntry',
          })),
        },
      ];
    },
  },

  // ARM-133: Draft Selling Model Referenced By Active Records
  // Doc: line 3171 — "You can\'t change status from Active or Inactive to
  // Draft." Active references to Draft means a botched data load.
  {
    id: 'ARM-133',
    name: 'Draft Product Selling Model Referenced By Active Records',
    category: 'arm_selling_models',
    severity: 'warning',
    description:
      'A Draft ProductSellingModel is referenced by an active PSMO or PBE — usually a migration mistake',
    run: async (data: ARMData): Promise<Issue[]> => {
      const draftIds = new Set(
        data.sellingModels
          .filter((m) => {
            const ext = m as unknown as { Status?: string | null };
            return ext.Status === 'Draft';
          })
          .map((m) => m.Id)
      );
      if (draftIds.size === 0) return [];
      const activeRefs = [
        ...data.sellingModelOptions.filter((o) => o.IsActive !== false && draftIds.has(o.ProductSellingModelId)),
        ...data.pricebookEntries.filter((pbe) => pbe.IsActive !== false && pbe.ProductSellingModelId && draftIds.has(pbe.ProductSellingModelId)),
      ];
      if (activeRefs.length === 0) return [];
      return [
        {
          check_id: 'ARM-133',
          category: 'arm_selling_models',
          severity: 'warning',
          title: `${activeRefs.length} active record(s) reference draft selling models`,
          description: `${draftIds.size} ProductSellingModel record(s) have Status='Draft' but are referenced by ${activeRefs.length} active PSMO/PBE record(s). Draft models should be invisible to the catalog.`,
          impact: 'Draft selling models appearing on active options or pricebook entries indicate a partially-completed data migration; runtime behavior may be unpredictable.',
          recommendation: 'Either promote the selling models to Active, or remove the references from the dependent PSMO/PBE records.',
          affected_records: Array.from(draftIds).slice(0, 25).map((id) => ({
            id,
            name: `SellingModel ${id.slice(-6)}`,
            type: 'ProductSellingModel',
          })),
        },
      ];
    },
  },

  // ─── PRODUCT QUALIFICATION (ARM-110 to ARM-112) ───────────────────

  // ARM-110: Expired ProductQualification still IsQualified=true
  {
    id: 'ARM-110',
    name: 'Expired Product Qualification Still Marked Qualified',
    category: 'arm_product_qualification',
    severity: 'critical',
    description:
      'ProductQualification past EffectiveToDate but IsQualified is still true',
    run: async (data: ARMData): Promise<Issue[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const expired = data.productQualifications.filter((q) => {
        if (q.IsQualified !== true) return false;
        if (!q.EffectiveToDate) return false;
        return q.EffectiveToDate < today;
      });
      if (expired.length === 0) return [];
      return [
        {
          check_id: 'ARM-110',
          category: 'arm_product_qualification',
          severity: 'critical',
          title: `${expired.length} expired product qualification(s) still flagged qualified`,
          description: `${expired.length} ProductQualification record(s) have EffectiveToDate in the past but IsQualified is still true. The Product Discovery engine continues to surface or hide products based on these stale rules.`,
          impact: 'Catalog shows products that should be off-market by now, or hides products that should now be available — both lead to incorrect sales experiences.',
          recommendation: 'Either flip IsQualified to false on the expired rules, or extend EffectiveToDate if the rule is still meant to apply.',
          affected_records: expired.slice(0, 25).map((q) => ({
            id: q.Id,
            name: q.Name || `Qualification ${q.Id.slice(-6)}`,
            type: 'ProductQualification',
          })),
        },
      ];
    },
  },

  // ARM-111: Reversed effective dates on ProductQualification
  {
    id: 'ARM-111',
    name: 'Product Qualification With Reversed Effective Dates',
    category: 'arm_product_qualification',
    severity: 'critical',
    description:
      'ProductQualification.EffectiveToDate is before EffectiveFromDate — rule never enters its window',
    run: async (data: ARMData): Promise<Issue[]> => {
      const reversed = data.productQualifications.filter(
        (q) => q.EffectiveFromDate && q.EffectiveToDate && q.EffectiveToDate < q.EffectiveFromDate
      );
      if (reversed.length === 0) return [];
      return [
        {
          check_id: 'ARM-111',
          category: 'arm_product_qualification',
          severity: 'critical',
          title: `${reversed.length} product qualification(s) with reversed dates`,
          description: `${reversed.length} ProductQualification record(s) have EffectiveToDate before EffectiveFromDate. The rule\'s effective window is empty — it never qualifies or disqualifies anything.`,
          impact: 'Catalog visibility silently breaks for the affected products — they never appear in (or never get hidden from) Product Discovery.',
          recommendation: 'Swap the date values or set the correct effective window so EffectiveFromDate ≤ EffectiveToDate.',
          affected_records: reversed.slice(0, 25).map((q) => ({
            id: q.Id,
            name: q.Name || `Qualification ${q.Id.slice(-6)}`,
            type: 'ProductQualification',
          })),
        },
      ];
    },
  },

  // ARM-112: ProductQualification points to inactive Product
  {
    id: 'ARM-112',
    name: 'Product Qualification References Inactive Product',
    category: 'arm_product_qualification',
    severity: 'warning',
    description:
      'ProductQualification\'s ProductId or RootProductId points to an inactive Product2',
    run: async (data: ARMData): Promise<Issue[]> => {
      const inactiveIds = new Set(
        data.products.filter((p) => p.IsActive === false).map((p) => p.Id)
      );
      const orphans = data.productQualifications.filter(
        (q) => (q.ProductId && inactiveIds.has(q.ProductId)) || (q.RootProductId && inactiveIds.has(q.RootProductId))
      );
      if (orphans.length === 0) return [];
      return [
        {
          check_id: 'ARM-112',
          category: 'arm_product_qualification',
          severity: 'warning',
          title: `${orphans.length} product qualification(s) point to inactive products`,
          description: `${orphans.length} ProductQualification record(s) reference Product2 records with IsActive=false. The rules waste decision-table evaluation cycles and complicate cleanup of legacy product lines.`,
          impact: 'Inactive product references clutter the qualification engine and may produce confusing audit logs when reviewing why a product appeared/disappeared from the catalog.',
          recommendation: 'Delete the qualification rules pointing to inactive products, or reactivate the products if they\'re still needed.',
          affected_records: orphans.slice(0, 25).map((q) => ({
            id: q.Id,
            name: q.Name || `Qualification ${q.Id.slice(-6)}`,
            type: 'ProductQualification',
          })),
        },
      ];
    },
  },

  // ─── RAMP DEALS (ARM-120 to ARM-122) ──────────────────────────────

  // ARM-120: Ramp segment without selling model
  {
    id: 'ARM-120',
    name: 'Product Ramp Segment Without Selling Model',
    category: 'arm_ramp_deals',
    severity: 'critical',
    description:
      'ProductRampSegment with SegmentType in {Yearly, Custom} but no ProductSellingModelId — segment can\'t be priced',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.productRampSegments.filter(
        (r) => !r.ProductSellingModelId && r.SegmentType && r.SegmentType !== 'FreeTrial'
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-120',
          category: 'arm_ramp_deals',
          severity: 'critical',
          title: `${offenders.length} ramp segment(s) without selling model`,
          description: `${offenders.length} ProductRampSegment record(s) of type Yearly or Custom have no ProductSellingModelId. Without a selling model the segment can\'t be priced and the entire ramp deal collapses on quote.`,
          impact: 'Quote line for a ramp deal returns no price for these segments — sales reps see "missing price" errors mid-configuration.',
          recommendation: 'Set ProductSellingModelId on each non-FreeTrial ramp segment.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || `Segment ${r.Id.slice(-6)}`,
            type: 'ProductRampSegment',
          })),
        },
      ];
    },
  },

  // ARM-121: FreeTrial ramp segment without trial duration
  {
    id: 'ARM-121',
    name: 'FreeTrial Ramp Segment Without Trial Duration',
    category: 'arm_ramp_deals',
    severity: 'critical',
    description:
      'FreeTrial ProductRampSegment has zero or null TrialDuration / DurationType',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.productRampSegments.filter(
        (r) => r.SegmentType === 'FreeTrial' && (!r.TrialDuration || r.TrialDuration <= 0 || !r.DurationType)
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-121',
          category: 'arm_ramp_deals',
          severity: 'critical',
          title: `${offenders.length} free-trial segment(s) with invalid duration`,
          description: `${offenders.length} ProductRampSegment record(s) with SegmentType='FreeTrial' have TrialDuration <= 0, null TrialDuration, or null DurationType. Either grants unlimited free use or zero — both wrong.`,
          impact: 'Customers either get an unbounded free trial (revenue loss) or a zero-day trial (failed quote configuration).',
          recommendation: 'Set both TrialDuration > 0 and DurationType (Days/Months/Years) on every FreeTrial segment.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || `Segment ${r.Id.slice(-6)}`,
            type: 'ProductRampSegment',
          })),
        },
      ];
    },
  },

  // ARM-122: Multiple Custom ramp segments per (product, sellingModel)
  {
    id: 'ARM-122',
    name: 'Overlapping Custom Ramp Segments On Same Product',
    category: 'arm_ramp_deals',
    severity: 'warning',
    description:
      'Multiple Custom ProductRampSegment records exist for the same (Product, SellingModel) pair — coverage may overlap',
    run: async (data: ARMData): Promise<Issue[]> => {
      const groups = new Map<string, typeof data.productRampSegments>();
      for (const r of data.productRampSegments) {
        if (r.SegmentType !== 'Custom') continue;
        if (!r.ProductId || !r.ProductSellingModelId) continue;
        const key = `${r.ProductId}|${r.ProductSellingModelId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const offenders: typeof data.productRampSegments = [];
      Array.from(groups.values()).forEach((segs) => {
        if (segs.length > 1) offenders.push(...segs);
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-122',
          category: 'arm_ramp_deals',
          severity: 'warning',
          title: `${offenders.length} custom ramp segment(s) may have overlapping coverage`,
          description: `${offenders.length} ProductRampSegment record(s) of type 'Custom' share the same (Product, SellingModel) pair. Custom segments need disjoint coverage; overlap causes non-deterministic price selection on amend/renew.`,
          impact: 'Renewal and amendment math becomes order-dependent — the same scenario priced twice can yield different results.',
          recommendation: 'Audit the date ranges on each duplicate Custom segment and ensure their coverage windows don\'t overlap.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name || `Segment ${r.Id.slice(-6)}`,
            type: 'ProductRampSegment',
          })),
        },
      ];
    },
  },

  // ─── FULFILLMENT extension (ARM-171) ──────────────────────────────

  // ARM-171: Self-referential or null-targeted step dependency
  {
    id: 'ARM-171',
    name: 'Fulfillment Step Dependency Self-Reference Or Null Target',
    category: 'arm_orchestration',
    severity: 'critical',
    description:
      'FulfillmentStepDependencyDef points to itself or has no DependsOnStepDefinitionId',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.fulfillmentStepDependencyDefs.filter(
        (d) => !d.DependsOnStepDefinitionId || d.DependsOnStepDefinitionId === d.FulfillmentStepDefinitionId
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-171',
          category: 'arm_orchestration',
          severity: 'critical',
          title: `${offenders.length} broken fulfillment step dependency(ies)`,
          description: `${offenders.length} FulfillmentStepDependencyDef record(s) either point to themselves (deadlock) or have null DependsOnStepDefinitionId (broken migration). The orchestration engine will hang or skip these steps unpredictably.`,
          impact: 'Self-dependent steps create infinite-wait deadlocks; null targets mean the dependency was never wired during data load — order fulfillment freezes mid-flow.',
          recommendation: 'Delete the self-referencing dependencies and re-create the step ordering. For null targets, set the correct predecessor step.',
          affected_records: offenders.slice(0, 25).map((d) => ({
            id: d.Id,
            name: d.Name || `Dependency ${d.Id.slice(-6)}`,
            type: 'FulfillmentStepDependencyDef',
          })),
        },
      ];
    },
  },

  // ─── TAX (ARM-180 to ARM-182) ─────────────────────────────────────

  // ARM-180: Active taxable TaxTreatment with no/inactive TaxEngine
  {
    id: 'ARM-180',
    name: 'Active Taxable Tax Treatment Without Tax Engine',
    category: 'arm_tax',
    severity: 'critical',
    description:
      'TaxTreatment is Active and IsTaxable but has no TaxEngineId, or its engine is inactive',
    run: async (data: ARMData): Promise<Issue[]> => {
      const activeEngineIds = new Set(
        data.taxEngines
          .filter((e) => e.IsActive !== false && (e.Status ?? 'Active') === 'Active')
          .map((e) => e.Id)
      );
      const offenders = data.taxTreatments.filter((t) => {
        if (t.Status !== 'Active') return false;
        if (t.IsTaxable !== true) return false;
        if (!t.TaxEngineId) return true;
        return !activeEngineIds.has(t.TaxEngineId);
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-180',
          category: 'arm_tax',
          severity: 'critical',
          title: `${offenders.length} taxable tax treatment(s) without active engine`,
          description: `${offenders.length} active taxable TaxTreatment record(s) either have no TaxEngineId or point to an inactive TaxEngine. CalculateTax fails when an order item references these treatments.`,
          impact: 'Order line tax calculation throws at runtime — invoicing stalls until manually unblocked. Doc explicitly: "If IsTaxable is True, the treatment requires a tax engine."',
          recommendation: 'Set a TaxEngineId pointing to an Active TaxEngine on every taxable treatment, or flip IsTaxable to false for non-taxable lines.',
          affected_records: offenders.slice(0, 25).map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'TaxTreatment',
          })),
        },
      ];
    },
  },

  // ARM-181: Active TaxTreatment with ShouldUseTaxTreatmentItems but no items
  {
    id: 'ARM-181',
    name: 'Tax Treatment Requires Items But None Linked',
    category: 'arm_tax',
    severity: 'critical',
    description:
      'TaxTreatment is Active with ShouldUseTaxTreatmentItems=true but has zero linked TaxTreatmentItem rows',
    run: async (data: ARMData): Promise<Issue[]> => {
      const itemsByTreatment = new Map<string, number>();
      for (const item of data.taxTreatmentItems) {
        itemsByTreatment.set(item.TaxTreatmentId, (itemsByTreatment.get(item.TaxTreatmentId) || 0) + 1);
      }
      const offenders = data.taxTreatments.filter(
        (t) => t.Status === 'Active' && t.ShouldUseTaxTreatmentItems === true && (itemsByTreatment.get(t.Id) || 0) === 0
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-181',
          category: 'arm_tax',
          severity: 'critical',
          title: `${offenders.length} tax treatment(s) need items but have none`,
          description: `${offenders.length} active TaxTreatment record(s) have ShouldUseTaxTreatmentItems=true but no TaxTreatmentItem children. When the flag is set, calculation expects per-item codes — without children, every line is taxed at fallback or fails.`,
          impact: 'Tax engine returns incorrect tax codes or errors out for every order item linked to these treatments.',
          recommendation: 'Either add the required TaxTreatmentItem children, or flip ShouldUseTaxTreatmentItems to false on treatments that don\'t need item-level codes.',
          affected_records: offenders.slice(0, 25).map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'TaxTreatment',
          })),
        },
      ];
    },
  },

  // ARM-182: Active TaxPolicy referencing inactive TaxTreatment
  {
    id: 'ARM-182',
    name: 'Active Tax Policy References Inactive Tax Treatment',
    category: 'arm_tax',
    severity: 'warning',
    description:
      'TaxPolicy is Active but at least one TaxTreatment under it is not Active',
    run: async (data: ARMData): Promise<Issue[]> => {
      const activePolicyIds = new Set(
        data.taxPolicies.filter((p) => p.Status === 'Active').map((p) => p.Id)
      );
      const offenders = data.taxTreatments.filter(
        (t) => t.TaxPolicyId && activePolicyIds.has(t.TaxPolicyId) && t.Status !== 'Active'
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-182',
          category: 'arm_tax',
          severity: 'warning',
          title: `${offenders.length} inactive tax treatment(s) under active policies`,
          description: `${offenders.length} TaxTreatment record(s) have Status != Active but their parent TaxPolicy is Active. Doc activation order: TaxTreatment first, then TaxPolicy. Reverse means tax routing references unusable treatments.`,
          impact: 'Tax policy delegation lookups silently skip the inactive treatments, causing fall-through to default routing or calculation errors.',
          recommendation: 'Activate the dependent TaxTreatments before activating the parent TaxPolicy, or deactivate the policy until the treatments are ready.',
          affected_records: offenders.slice(0, 25).map((t) => ({
            id: t.Id,
            name: t.Name,
            type: 'TaxTreatment',
          })),
        },
      ];
    },
  },

  // ─── BILLING POLICIES (ARM-190 to ARM-193) ────────────────────────

  // ARM-190: Active BillingPolicy default mode without active default treatment
  {
    id: 'ARM-190',
    name: 'Active Billing Policy Default Mode Without Default Treatment',
    category: 'arm_billing_policies',
    severity: 'critical',
    description:
      'Active BillingPolicy with BillingTreatmentSelection=Default lacks DefaultBillingTreatmentId or treatment is inactive',
    run: async (data: ARMData): Promise<Issue[]> => {
      const activeTreatmentIds = new Set(
        data.billingTreatments.filter((t) => t.Status === 'Active').map((t) => t.Id)
      );
      const offenders = data.billingPolicies.filter((p) => {
        if (p.Status !== 'Active') return false;
        if (p.BillingTreatmentSelection !== 'Default') return false;
        if (!p.DefaultBillingTreatmentId) return true;
        return !activeTreatmentIds.has(p.DefaultBillingTreatmentId);
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-190',
          category: 'arm_billing_policies',
          severity: 'critical',
          title: `${offenders.length} billing policy(ies) missing default treatment`,
          description: `${offenders.length} active BillingPolicy record(s) use BillingTreatmentSelection='Default' but either have no DefaultBillingTreatmentId or point to an inactive treatment. Order items linked to these policies can\'t pick a billing treatment and fail invoicing.`,
          impact: 'Invoice generation fails for order items routed through these policies — billing batch jobs surface as failed with no automatic recovery.',
          recommendation: 'Set DefaultBillingTreatmentId on every Default-mode policy and ensure the referenced BillingTreatment is Active.',
          affected_records: offenders.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'BillingPolicy',
          })),
        },
      ];
    },
  },

  // ARM-191: Active BillingArrangement with no lines
  {
    id: 'ARM-191',
    name: 'Active Billing Arrangement Without Lines',
    category: 'arm_billing_policies',
    severity: 'critical',
    description:
      'BillingArrangement is Active but has zero BillingArrangementLine children',
    run: async (data: ARMData): Promise<Issue[]> => {
      const linesByArrangement = new Map<string, number>();
      for (const line of data.billingArrangementLines) {
        linesByArrangement.set(line.BillingArrangementId, (linesByArrangement.get(line.BillingArrangementId) || 0) + 1);
      }
      const offenders = data.billingArrangements.filter(
        (a) => a.Status === 'Active' && (linesByArrangement.get(a.Id) || 0) === 0
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-191',
          category: 'arm_billing_policies',
          severity: 'critical',
          title: `${offenders.length} active billing arrangement(s) with no lines`,
          description: `${offenders.length} BillingArrangement record(s) are Active but have zero BillingArrangementLine children. Doc explicitly: "Before you activate it, add at least one billing arrangement line."`,
          impact: 'Active arrangements with no lines produce no billing schedule — customers don\'t get invoiced for the underlying contracts at all.',
          recommendation: 'Add at least one BillingArrangementLine to each affected arrangement, or deactivate empty arrangements until they\'re fully populated.',
          affected_records: offenders.slice(0, 25).map((a) => ({
            id: a.Id,
            name: a.Name || `Arrangement ${a.Id.slice(-6)}`,
            type: 'BillingArrangement',
          })),
        },
      ];
    },
  },

  // ARM-192: Active BillingMilestonePlan without items or with inactive treatment
  {
    id: 'ARM-192',
    name: 'Active Billing Milestone Plan Without Items Or Inactive Treatment',
    category: 'arm_billing_policies',
    severity: 'critical',
    description:
      'BillingMilestonePlan is Active without items, or its BillingTreatment is not Active',
    run: async (data: ARMData): Promise<Issue[]> => {
      const itemsByPlan = new Map<string, number>();
      for (const item of data.billingMilestonePlanItems) {
        itemsByPlan.set(item.BillingMilestonePlanId, (itemsByPlan.get(item.BillingMilestonePlanId) || 0) + 1);
      }
      const activeTreatmentIds = new Set(
        data.billingTreatments.filter((t) => t.Status === 'Active').map((t) => t.Id)
      );
      const offenders = data.billingMilestonePlans.filter((p) => {
        if (p.Status !== 'Active') return false;
        const itemCount = itemsByPlan.get(p.Id) || 0;
        if (itemCount === 0) return true;
        if (p.BillingTreatmentId && !activeTreatmentIds.has(p.BillingTreatmentId)) return true;
        return false;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-192',
          category: 'arm_billing_policies',
          severity: 'critical',
          title: `${offenders.length} milestone plan(s) with broken activation prerequisites`,
          description: `${offenders.length} active BillingMilestonePlan record(s) either have no plan items or reference an inactive BillingTreatment. Doc requires "at least one billing milestone plan item must exist before activation" and "the related billing treatment must be active before you activate the plan."`,
          impact: 'Milestone-based invoicing produces no billing events for these plans — milestone-driven contracts go unbilled.',
          recommendation: 'Add at least one BillingMilestonePlanItem and ensure BillingTreatmentId references an Active treatment before keeping the plan Active.',
          affected_records: offenders.slice(0, 25).map((p) => ({
            id: p.Id,
            name: p.Name,
            type: 'BillingMilestonePlan',
          })),
        },
      ];
    },
  },

  // ARM-193: Multiple active org-default PaymentRetryRuleSets
  {
    id: 'ARM-193',
    name: 'Multiple Active Org-Default Payment Retry Rule Sets',
    category: 'arm_billing_policies',
    severity: 'critical',
    description:
      'More than one PaymentRetryRuleSet is both Active and IsOrgDefault — non-deterministic dunning',
    run: async (data: ARMData): Promise<Issue[]> => {
      const orgDefaults = data.paymentRetryRuleSets.filter(
        (s) => s.Status === 'Active' && s.IsOrgDefault === true
      );
      if (orgDefaults.length <= 1) return [];
      return [
        {
          check_id: 'ARM-193',
          category: 'arm_billing_policies',
          severity: 'critical',
          title: `${orgDefaults.length} active org-default payment retry rule sets`,
          description: `${orgDefaults.length} PaymentRetryRuleSet record(s) are simultaneously Active and IsOrgDefault=true. Doc explicitly: "The org can't have multiple active org-default rule sets." Two active defaults give non-deterministic dunning behavior.`,
          impact: 'Failed payment retries pick whichever rule set Salesforce evaluates first — collections workflow becomes inconsistent across customers.',
          recommendation: 'Choose one rule set as the org-default and flip IsOrgDefault to false on all others.',
          affected_records: orgDefaults.slice(0, 25).map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'PaymentRetryRuleSet',
          })),
        },
      ];
    },
  },

  // ─── GENERAL LEDGER (ARM-200 to ARM-202) ──────────────────────────

  // ARM-200: GL assignment rule missing credit or debit account
  {
    id: 'ARM-200',
    name: 'Active GL Assignment Rule Missing Credit Or Debit Account',
    category: 'arm_general_ledger',
    severity: 'critical',
    description:
      'GeneralLedgerAcctAsgntRule is Active but lacks either CreditGeneralLedgerAccountId or DebitGeneralLedgerAccountId',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.generalLedgerAcctAsgntRules.filter(
        (r) => r.Status === 'Active' && (!r.CreditGeneralLedgerAccountId || !r.DebitGeneralLedgerAccountId)
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-200',
          category: 'arm_general_ledger',
          severity: 'critical',
          title: `${offenders.length} GL assignment rule(s) missing credit or debit account`,
          description: `${offenders.length} GeneralLedgerAcctAsgntRule record(s) are Active but missing one or both of CreditGeneralLedgerAccountId / DebitGeneralLedgerAccountId. Doc: "The rule can be active only when both a credit and a debit general ledger account are present."`,
          impact: 'Migrated rules missing one side post journal entries to a single side and break the trial balance — finance reconciliation fails at month-end close.',
          recommendation: 'Set both CreditGeneralLedgerAccountId and DebitGeneralLedgerAccountId on every active rule, or deactivate rules that aren\'t fully wired.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'GeneralLedgerAcctAsgntRule',
          })),
        },
      ];
    },
  },

  // ARM-201: GL assignment rule with cross-legal-entity accounts
  {
    id: 'ARM-201',
    name: 'GL Assignment Rule With Cross-Legal-Entity Accounts',
    category: 'arm_general_ledger',
    severity: 'critical',
    description:
      'Credit account, debit account, and rule\'s LegalEntityId aren\'t all the same legal entity',
    run: async (data: ARMData): Promise<Issue[]> => {
      const glaById = new Map(
        data.generalLedgerAccounts.map((g) => [g.Id, g.LegalEntityId || null])
      );
      const offenders = data.generalLedgerAcctAsgntRules.filter((r) => {
        if (!r.CreditGeneralLedgerAccountId || !r.DebitGeneralLedgerAccountId || !r.LegalEntityId) return false;
        const creditLE = glaById.get(r.CreditGeneralLedgerAccountId);
        const debitLE = glaById.get(r.DebitGeneralLedgerAccountId);
        if (!creditLE || !debitLE) return false;
        return creditLE !== r.LegalEntityId || debitLE !== r.LegalEntityId;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-201',
          category: 'arm_general_ledger',
          severity: 'critical',
          title: `${offenders.length} GL rule(s) span multiple legal entities`,
          description: `${offenders.length} GeneralLedgerAcctAsgntRule record(s) reference credit/debit accounts in different legal entities than the rule itself. Doc: "The credit account, debit account, and assignment rule must belong to the same legal entity."`,
          impact: 'Inter-company posting errors at journal-entry creation; transactions may be rejected or routed to suspense accounts requiring manual reclassification.',
          recommendation: 'Re-pick credit and debit accounts so they all share the rule\'s LegalEntityId, or move the rule to the matching legal entity.',
          affected_records: offenders.slice(0, 25).map((r) => ({
            id: r.Id,
            name: r.Name,
            type: 'GeneralLedgerAcctAsgntRule',
          })),
        },
      ];
    },
  },

  // ARM-202: Closed AccountingPeriod with non-closed children
  {
    id: 'ARM-202',
    name: 'Closed Accounting Period With Open Legal-Entity Children',
    category: 'arm_general_ledger',
    severity: 'critical',
    description:
      'AccountingPeriod is Closed but at least one LegalEntityAccountingPeriod child is not Closed',
    run: async (data: ARMData): Promise<Issue[]> => {
      const closedParents = new Set(
        data.accountingPeriods.filter((p) => p.Status === 'Closed').map((p) => p.Id)
      );
      const openChildren = data.legalEntityAccountingPeriods.filter(
        (c) => closedParents.has(c.AccountingPeriodId) && c.Status !== 'Closed' && c.Status !== 'Error'
      );
      if (openChildren.length === 0) return [];
      const parentIds = Array.from(new Set(openChildren.map((c) => c.AccountingPeriodId)));
      return [
        {
          check_id: 'ARM-202',
          category: 'arm_general_ledger',
          severity: 'critical',
          title: `${parentIds.length} closed accounting period(s) have open children`,
          description: `${parentIds.length} AccountingPeriod record(s) are Closed but ${openChildren.length} LegalEntityAccountingPeriod child(ren) remain non-closed. Doc: "The parent record can\'t close if any non-closed child record exists." This indicates corrupted state.`,
          impact: 'Subsequent period operations (journal posting, period adjustments, reporting) error out because the period state graph is internally inconsistent.',
          recommendation: 'Identify why the children weren\'t closed — usually orphaned journal entries — fix those, then close the children. Reopen and re-close the parent if needed.',
          affected_records: parentIds.slice(0, 25).map((id) => {
            const period = data.accountingPeriods.find((p) => p.Id === id);
            return {
              id,
              name: period?.Name || `Period ${id.slice(-6)}`,
              type: 'AccountingPeriod',
            };
          }),
        },
      ];
    },
  },

  // ─── CONTRACT CLAUSES (ARM-210 to ARM-214) ────────────────────────

  // ARM-210: Active DocumentClause without content
  {
    id: 'ARM-210',
    name: 'Active Document Clause Without Content',
    category: 'arm_clauses',
    severity: 'critical',
    description:
      'DocumentClause is Active but Content is null or empty',
    run: async (data: ARMData): Promise<Issue[]> => {
      const offenders = data.documentClauses.filter(
        (c) => c.Status === 'Active' && (!c.Content || c.Content.trim() === '')
      );
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-210',
          category: 'arm_clauses',
          severity: 'critical',
          title: `${offenders.length} active document clause(s) without content`,
          description: `${offenders.length} DocumentClause record(s) are Active but have null or empty Content. Doc validation rule: "Requires clause content before changing status to Active." A blank active clause produces empty paragraphs in generated contract documents.`,
          impact: 'Contracts generated with these clauses inserted contain blank sections — legal review rejects, sales cycle stalls.',
          recommendation: 'Either populate Content on every active clause, or revert blank clauses to Draft until they\'re ready.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.ClauseName || `Clause ${c.Id.slice(-6)}`,
            type: 'DocumentClause',
          })),
        },
      ];
    },
  },

  // ARM-211: Multiple main clauses per group/language within set
  {
    id: 'ARM-211',
    name: 'Multiple Main Clauses Per Group/Language In Clause Set',
    category: 'arm_clauses',
    severity: 'critical',
    description:
      'A clause set has more than one main (non-alternate) clause for the same ClauseName + ClauseLanguage',
    run: async (data: ARMData): Promise<Issue[]> => {
      const groups = new Map<string, typeof data.documentClauses>();
      for (const c of data.documentClauses) {
        if (c.IsAlternateClause === true) continue;
        if (!c.DocumentClauseSetId) continue;
        const key = `${c.DocumentClauseSetId}|${c.ClauseName ?? 'unnamed'}|${c.ClauseLanguage ?? ''}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(c);
      }
      const offenders: typeof data.documentClauses = [];
      Array.from(groups.values()).forEach((arr) => {
        if (arr.length > 1) offenders.push(...arr);
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-211',
          category: 'arm_clauses',
          severity: 'critical',
          title: `${offenders.length} duplicate main clause(s) in clause sets`,
          description: `${offenders.length} DocumentClause record(s) share the same (DocumentClauseSet, ClauseName, ClauseLanguage) where IsAlternateClause=false. Doc: "Allows only one main clause per clause group… one main clause per language within a clause set."`,
          impact: 'Template generation picks one duplicate non-deterministically — different generated contracts contain different clause text for the same template/language combination.',
          recommendation: 'Mark duplicates as IsAlternateClause=true, or merge them into a single main clause per (set, name, language) tuple.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.ClauseName || `Clause ${c.Id.slice(-6)}`,
            type: 'DocumentClause',
          })),
        },
      ];
    },
  },

  // ARM-212: Alternate clause without a main clause in the group
  {
    id: 'ARM-212',
    name: 'Alternate Clause Without Main Clause Sibling',
    category: 'arm_clauses',
    severity: 'critical',
    description:
      'Alternate DocumentClause has no main (non-alternate) sibling for the same set / name / language',
    run: async (data: ARMData): Promise<Issue[]> => {
      const mainSet = new Set<string>();
      for (const c of data.documentClauses) {
        if (c.IsAlternateClause === true) continue;
        if (!c.DocumentClauseSetId) continue;
        mainSet.add(`${c.DocumentClauseSetId}|${c.ClauseName ?? 'unnamed'}|${c.ClauseLanguage ?? ''}`);
      }
      const orphans = data.documentClauses.filter((c) => {
        if (c.IsAlternateClause !== true) return false;
        if (!c.DocumentClauseSetId) return false;
        const key = `${c.DocumentClauseSetId}|${c.ClauseName ?? 'unnamed'}|${c.ClauseLanguage ?? ''}`;
        return !mainSet.has(key);
      });
      if (orphans.length === 0) return [];
      return [
        {
          check_id: 'ARM-212',
          category: 'arm_clauses',
          severity: 'critical',
          title: `${orphans.length} orphan alternate clause(s)`,
          description: `${orphans.length} DocumentClause record(s) have IsAlternateClause=true but no main clause exists for the same (set, name, language). Doc: "Requires an existing main clause before inserting alternate clauses."`,
          impact: 'Orphan alternates can\'t be selected from the template picker because the picker keys off the main clause — these alternates are effectively unusable.',
          recommendation: 'Either flip the orphan to be the main clause (IsAlternateClause=false), or create a main clause sibling, or delete the orphan.',
          affected_records: orphans.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.ClauseName || `Clause ${c.Id.slice(-6)}`,
            type: 'DocumentClause',
          })),
        },
      ];
    },
  },

  // ARM-213: DocumentClause referencing missing or inactive ClauseSet
  {
    id: 'ARM-213',
    name: 'Document Clause References Missing Or Inactive Clause Set',
    category: 'arm_clauses',
    severity: 'critical',
    description:
      'DocumentClause.DocumentClauseSetId resolves to nothing or to an inactive set',
    run: async (data: ARMData): Promise<Issue[]> => {
      const setsById = new Map(
        data.documentClauseSets.map((s) => [s.Id, s])
      );
      const offenders = data.documentClauses.filter((c) => {
        if (!c.DocumentClauseSetId) return false;
        const set = setsById.get(c.DocumentClauseSetId);
        if (!set) return true;
        return set.Status !== 'Active';
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-213',
          category: 'arm_clauses',
          severity: 'critical',
          title: `${offenders.length} clause(s) reference missing/inactive clause sets`,
          description: `${offenders.length} DocumentClause record(s) point to a DocumentClauseSetId that either doesn\'t exist in the org or whose Status is not Active. Doc: "Requires each clause to reference a valid DocumentClauseSet that exists in the target org."`,
          impact: 'Microsoft 365 template generation stalls at clause resolution — contract documents fail to render.',
          recommendation: 'Re-link clauses to a valid Active DocumentClauseSet, or activate the existing set if it\'s in Inactive/Draft state.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.ClauseName || `Clause ${c.Id.slice(-6)}`,
            type: 'DocumentClause',
          })),
        },
      ];
    },
  },

  // ARM-214: Archived clause modified after creation (immutability breach)
  {
    id: 'ARM-214',
    name: 'Archived Clause Modified After Archival',
    category: 'arm_clauses',
    severity: 'warning',
    description:
      'DocumentClause is Archived but LastModifiedDate is significantly after CreatedDate, indicating a post-archive edit',
    run: async (data: ARMData): Promise<Issue[]> => {
      // Only flag when LastModified is more than ~5 minutes after Created.
      // Some Salesforce processes update timestamps minimally during archive
      // operations; we want to catch real edits, not housekeeping updates.
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const offenders = data.documentClauses.filter((c) => {
        if (c.Status !== 'Archived') return false;
        if (!c.CreatedDate || !c.LastModifiedDate) return false;
        const created = new Date(c.CreatedDate).getTime();
        const modified = new Date(c.LastModifiedDate).getTime();
        if (isNaN(created) || isNaN(modified)) return false;
        return modified - created > FIVE_MIN_MS;
      });
      if (offenders.length === 0) return [];
      return [
        {
          check_id: 'ARM-214',
          category: 'arm_clauses',
          severity: 'warning',
          title: `${offenders.length} archived clause(s) modified post-archive`,
          description: `${offenders.length} DocumentClause record(s) are Archived but LastModifiedDate is more than 5 minutes after CreatedDate, suggesting they were edited after archival. Doc: "Prevents updates to Archived clauses." Real edits to archived records likely indicate a broken migration that bypassed validation.`,
          impact: 'Archived clauses are supposed to be immutable; modifications after archive break the audit trail and could affect contracts that referenced the clause at sign time.',
          recommendation: 'Audit each modification against the change log. If the edits were unintentional, revert the clause content; if intentional, create a new active clause version instead of editing an archived one.',
          affected_records: offenders.slice(0, 25).map((c) => ({
            id: c.Id,
            name: c.Name || c.ClauseName || `Clause ${c.Id.slice(-6)}`,
            type: 'DocumentClause',
          })),
        },
      ];
    },
  },
];
