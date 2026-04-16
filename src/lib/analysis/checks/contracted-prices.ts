import type { HealthCheck, CPQData, Issue } from '@/types';

export const contractedPriceChecks: HealthCheck[] = [
  // CP-002: Contracted Prices Without Effective Date
  {
    id: 'CP-002',
    name: 'Contracted Prices Missing Effective Date',
    category: 'contracted_prices',
    severity: 'critical',
    description: 'Contracted prices without an effective date — pricing may apply unexpectedly',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const noDate = data.contractedPrices.filter(
        (cp) => !cp.SBQQ__EffectiveDate__c && !cp.SBQQ__ExpirationDate__c
      );

      if (noDate.length > 0) {
        issues.push({
          check_id: 'CP-002',
          category: 'contracted_prices',
          severity: 'critical',
          title: `${noDate.length} contracted price(s) without effective or expiration date`,
          description: `Found ${noDate.length} contracted price record(s) with neither effective date nor expiration date set. These prices apply indefinitely and may override standard pricing unexpectedly.`,
          impact: 'Contracted prices without date boundaries apply to all quotes for the account forever, even after the agreement has expired.',
          recommendation: 'Set effective and expiration dates on all contracted prices to match the underlying pricing agreement.',
          affected_records: noDate.slice(0, 20).map((cp) => ({
            id: cp.Id,
            name: `${cp.SBQQ__Account__r?.Name || 'Unknown'} - ${cp.SBQQ__Product__r?.Name || 'Unknown'}`,
            type: 'SBQQ__ContractedPrice__c',
          })),
        });
      }

      return issues;
    },
  },

  // CP-001: Expired or Stale Contracted Prices
  {
    id: 'CP-001',
    name: 'Expired Contracted Prices',
    category: 'contracted_prices',
    severity: 'warning',
    description: 'Contracted prices that have expired but still exist, or reference inactive products',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const today = new Date().toISOString().split('T')[0];

      // Check for expired contracted prices
      const expired = data.contractedPrices.filter(
        (cp) => cp.SBQQ__ExpirationDate__c && cp.SBQQ__ExpirationDate__c < today
      );

      if (expired.length > 0) {
        issues.push({
          check_id: 'CP-001',
          category: 'contracted_prices',
          severity: 'warning',
          title: `${expired.length} expired contracted price(s) found`,
          description: `Found ${expired.length} contracted price record(s) past their expiration date. These records are no longer applied to quotes but still clutter the system and may confuse users checking account-level pricing.`,
          impact: 'Expired contracted prices can mislead admins into thinking special pricing is still active. They also slow down quote calculation as CPQ evaluates all contracted prices.',
          recommendation: 'Review and delete expired contracted prices, or extend their expiration dates if the pricing agreements were renewed.',
          affected_records: expired.slice(0, 20).map((cp) => ({
            id: cp.Id,
            name: `${cp.SBQQ__Account__r?.Name || 'Unknown'} - ${cp.SBQQ__Product__r?.Name || 'Unknown'} (expired ${cp.SBQQ__ExpirationDate__c})`,
            type: 'SBQQ__ContractedPrice__c',
          })),
        });
      }

      // Check for contracted prices referencing inactive products
      const inactiveProduct = data.contractedPrices.filter(
        (cp) => cp.SBQQ__Product__r && cp.SBQQ__Product__r.IsActive === false
      );

      if (inactiveProduct.length > 0) {
        issues.push({
          check_id: 'CP-001',
          category: 'contracted_prices',
          severity: 'warning',
          title: `${inactiveProduct.length} contracted price(s) reference inactive products`,
          description: `Found ${inactiveProduct.length} contracted price record(s) linked to products that are no longer active. These prices will never be applied since the products can't be added to quotes.`,
          impact: 'Orphaned records that add noise and slow down contracted price evaluation during quote calculation.',
          recommendation: 'Delete contracted prices for inactive products, or reactivate the products if the pricing agreements are still valid.',
          affected_records: inactiveProduct.slice(0, 20).map((cp) => ({
            id: cp.Id,
            name: `${cp.SBQQ__Account__r?.Name || 'Unknown'} - ${cp.SBQQ__Product__r?.Name || 'Unknown'}`,
            type: 'SBQQ__ContractedPrice__c',
          })),
        });
      }

      // Check for contracted prices with null/zero price
      const zeroPrice = data.contractedPrices.filter(
        (cp) =>
          (cp.SBQQ__Price__c === null || cp.SBQQ__Price__c === 0) &&
          (!cp.SBQQ__ExpirationDate__c || cp.SBQQ__ExpirationDate__c >= today)
      );

      if (zeroPrice.length > 0) {
        issues.push({
          check_id: 'CP-001',
          category: 'contracted_prices',
          severity: 'warning',
          title: `${zeroPrice.length} active contracted price(s) with zero or null price`,
          description: `Found ${zeroPrice.length} active contracted price record(s) where SBQQ__Price__c is zero or null. These will override standard pricebook pricing with $0.`,
          impact: 'Products will appear as free on quotes for these accounts. If unintentional, this causes direct revenue loss.',
          recommendation: 'Verify each $0 contracted price is intentional (e.g., promotional/trial pricing). Correct any that should have a value.',
          affected_records: zeroPrice.slice(0, 20).map((cp) => ({
            id: cp.Id,
            name: `${cp.SBQQ__Account__r?.Name || 'Unknown'} - ${cp.SBQQ__Product__r?.Name || 'Unknown'}`,
            type: 'SBQQ__ContractedPrice__c',
          })),
          revenue_impact: zeroPrice.length * 200,
        });
      }

      return issues;
    },
  },

  // CP-003: Contracted Prices Without Original Quote Line
  {
    id: 'CP-003',
    name: 'Contracted Prices Without Source Quote Line',
    category: 'contracted_prices',
    severity: 'info',
    description: 'Contracted prices created manually rather than flowing from a quote — harder to audit',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const noSource = data.contractedPrices.filter((cp) => !cp.SBQQ__OriginalQuoteLine__c);

      if (noSource.length > 0) {
        issues.push({
          check_id: 'CP-003',
          category: 'contracted_prices',
          severity: 'info',
          title: `${noSource.length} contracted price(s) without source quote line`,
          description: `Found ${noSource.length} contracted price(s) that were not created from a quote line. These were likely created manually or via data load, making them harder to audit and trace.`,
          impact: 'Manual contracted prices lack the audit trail of quote-originated pricing. Harder to verify the pricing was approved correctly.',
          recommendation: 'Document the source of manually created contracted prices. Consider using the standard quote-to-contract flow for better traceability.',
          affected_records: noSource.slice(0, 10).map((cp) => ({
            id: cp.Id,
            name: `${cp.SBQQ__Account__r?.Name || 'Unknown'} - ${cp.SBQQ__Product__r?.Name || 'Unknown'}`,
            type: 'SBQQ__ContractedPrice__c',
          })),
        });
      }

      return issues;
    },
  },
];
