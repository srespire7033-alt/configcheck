import type { HealthCheck, CPQData, Issue } from '@/types';

export const bundleIntegrityChecks: HealthCheck[] = [
  // BN-001: Empty Bundles
  {
    id: 'BN-001',
    name: 'Empty Bundles',
    category: 'bundles',
    severity: 'critical',
    description: 'Bundle products with configuration type set but no product options',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Find products that are configured as bundles
      const bundles = data.products.filter(
        (p) => p.IsActive && p.SBQQ__ConfigurationType__c
      );

      // Build set of parent product IDs from product options
      const parentsWithOptions = new Set(
        data.productOptions.map((o) => o.SBQQ__ConfiguredSKU__c)
      );

      const emptyBundles = bundles.filter((b) => !parentsWithOptions.has(b.Id));

      for (const bundle of emptyBundles) {
        issues.push({
          check_id: 'BN-001',
          category: 'bundles',
          severity: 'critical',
          title: `Empty bundle "${bundle.Name}"`,
          description: `"${bundle.Name}" has Configuration Type = "${bundle.SBQQ__ConfigurationType__c}" but has zero product options. The configurator will open with a blank page.`,
          impact: 'Sales reps see an empty configurator when adding this product — confusing UX and potential lost deals.',
          recommendation: `Add product options to "${bundle.Name}" or remove its Configuration Type if it's not a bundle.`,
          affected_records: [{ id: bundle.Id, name: bundle.Name, type: 'Product2' }],
        });
      }

      return issues;
    },
  },

  // BN-002: Option Quantity Mismatch
  {
    id: 'BN-002',
    name: 'Option Min/Max Quantity Mismatch',
    category: 'bundles',
    severity: 'warning',
    description: 'Product options where minimum quantity exceeds maximum quantity',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const option of data.productOptions) {
        const min = option.SBQQ__MinQuantity__c;
        const max = option.SBQQ__MaxQuantity__c;

        if (min != null && max != null && min > max) {
          const parentName = option.SBQQ__ConfiguredSKU__r?.Name || 'Unknown Bundle';
          const childName = option.SBQQ__OptionalSKU__r?.Name || 'Unknown Product';
          issues.push({
            check_id: 'BN-002',
            category: 'bundles',
            severity: 'warning',
            title: `Option quantity mismatch on "${childName}"`,
            description: `Product option "${option.Name}" in bundle "${parentName}" has Min Quantity (${min}) greater than Max Quantity (${max}). Users cannot satisfy both constraints simultaneously.`,
            impact: 'Configurator may block valid selections or produce unpredictable quantity behavior.',
            recommendation: `Fix the quantities: set Min ≤ Max on option "${option.Name}" in bundle "${parentName}".`,
            affected_records: [
              { id: option.Id, name: option.Name, type: 'SBQQ__ProductOption__c' },
            ],
          });
        }
      }

      return issues;
    },
  },

  // BN-003: Deeply Nested Bundles
  {
    id: 'BN-003',
    name: 'Deeply Nested Bundles',
    category: 'bundles',
    severity: 'warning',
    description: 'Bundle nesting exceeds 3 levels deep, causing performance and UX issues',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Build parent→children adjacency map
      const childrenOf: Record<string, string[]> = {};
      for (const option of data.productOptions) {
        const parent = option.SBQQ__ConfiguredSKU__c;
        if (!childrenOf[parent]) childrenOf[parent] = [];
        childrenOf[parent].push(option.SBQQ__OptionalSKU__c);
      }

      // Find top-level bundles (bundles that are not children of other bundles)
      const allChildren = new Set(data.productOptions.map((o) => o.SBQQ__OptionalSKU__c));
      const topBundles = Object.keys(childrenOf).filter((id) => !allChildren.has(id));

      // BFS to measure depth
      function getMaxDepth(rootId: string): number {
        let maxDepth = 1;
        const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 1 }];
        const visited = new Set<string>();
        visited.add(rootId);

        while (queue.length > 0) {
          const { id, depth } = queue.shift()!;
          const children = childrenOf[id];
          if (!children) continue;

          for (const child of children) {
            if (visited.has(child)) continue;
            visited.add(child);
            const childDepth = depth + 1;
            if (childDepth > maxDepth) maxDepth = childDepth;
            if (childrenOf[child]) {
              queue.push({ id: child, depth: childDepth });
            }
          }
        }
        return maxDepth;
      }

      for (const bundleId of topBundles) {
        const depth = getMaxDepth(bundleId);
        if (depth > 3) {
          const product = data.products.find((p) => p.Id === bundleId);
          const name = product?.Name || bundleId;
          issues.push({
            check_id: 'BN-003',
            category: 'bundles',
            severity: 'warning',
            title: `Bundle "${name}" nested ${depth} levels deep`,
            description: `"${name}" has a nesting depth of ${depth} levels. Salesforce CPQ performance degrades significantly beyond 3 levels of nesting, and the configurator UX becomes confusing.`,
            impact: 'Slow quote calculation, configurator timeouts, and poor user experience.',
            recommendation: `Flatten the bundle hierarchy for "${name}" to 3 levels or fewer. Consider using product rules instead of deep nesting.`,
            affected_records: [{ id: bundleId, name, type: 'Product2' }],
          });
        }
      }

      return issues;
    },
  },

  // BN-004: Required Options Without Price Book Entry
  {
    id: 'BN-004',
    name: 'Required Options Without Price Book Entry',
    category: 'bundles',
    severity: 'critical',
    description: 'Required bundle options pointing to products without price book entries',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const productsWithPBE = new Set(data.pricebookEntries.map((e) => e.Product2Id));

      const requiredOptions = data.productOptions.filter(
        (o) => o.SBQQ__Required__c === true
      );

      for (const option of requiredOptions) {
        const childId = option.SBQQ__OptionalSKU__c;
        const childActive = option.SBQQ__OptionalSKU__r?.IsActive;

        // Only check active child products
        if (childActive === false) continue;

        if (!productsWithPBE.has(childId)) {
          const parentName = option.SBQQ__ConfiguredSKU__r?.Name || 'Unknown Bundle';
          const childName = option.SBQQ__OptionalSKU__r?.Name || 'Unknown Product';
          issues.push({
            check_id: 'BN-004',
            category: 'bundles',
            severity: 'critical',
            title: `Required option "${childName}" has no price book entry`,
            description: `Bundle "${parentName}" requires option "${childName}" but the product has no price book entry. The bundle will fail when added to a quote.`,
            impact: 'Quote line creation will fail for this bundle — sales reps cannot sell it.',
            recommendation: `Add a price book entry for "${childName}" or make the option non-required.`,
            affected_records: [
              { id: option.Id, name: option.Name, type: 'SBQQ__ProductOption__c' },
            ],
          });
        }
      }

      return issues;
    },
  },
];
