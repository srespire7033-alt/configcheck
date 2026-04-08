import type { HealthCheck, CPQData, Issue } from '@/types';

export const contractedPriceChecks: HealthCheck[] = [
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
];
