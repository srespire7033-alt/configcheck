import type { BillingData, BillingHealthCheck, Issue } from '@/types';

export const legalEntityChecks: BillingHealthCheck[] = [
  {
    id: 'LE-001',
    name: 'No Legal Entity Defined',
    category: 'legal_entity',
    severity: 'critical',
    description: 'Checks if the org has at least one legal entity configured',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      if (data.legalEntities.length === 0) {
        issues.push({
          check_id: 'LE-001',
          category: 'legal_entity',
          severity: 'critical',
          title: 'No legal entity defined',
          description: 'No legal entities found in this org. Legal entities are required for invoice generation and tax compliance.',
          impact: 'Invoice generation and tax calculations will not function without a legal entity.',
          recommendation: 'Create at least one legal entity with complete address information.',
          affected_records: [],
          revenue_impact: 100000,
          effort_hours: 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'LE-002',
    name: 'Legal Entity Missing Address',
    category: 'legal_entity',
    severity: 'warning',
    description: 'Finds legal entities with incomplete address information',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const missingAddress = data.legalEntities.filter(le => {
        if (!le.blng__Active__c) return false;
        return !le.blng__Street__c || !le.blng__City__c || !le.blng__Country__c;
      });

      if (missingAddress.length > 0) {
        issues.push({
          check_id: 'LE-002',
          category: 'legal_entity',
          severity: 'warning',
          title: 'Legal entities with incomplete address',
          description: `${missingAddress.length} active legal entity(ies) are missing required address fields (street, city, or country).`,
          impact: 'Invoices may have incomplete company address, affecting professional appearance and tax compliance.',
          recommendation: 'Complete the address fields on each legal entity.',
          affected_records: missingAddress.map(le => ({
            id: le.Id,
            name: le.Name,
            type: 'blng__LegalEntity__c',
          })),
          effort_hours: missingAddress.length * 0.25,
        });
      }

      return issues;
    },
  },
  {
    id: 'LE-003',
    name: 'Inactive Legal Entity',
    category: 'legal_entity',
    severity: 'warning',
    description: 'Finds inactive legal entities that may still be referenced',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const inactive = data.legalEntities.filter(le => !le.blng__Active__c);

      if (inactive.length > 0 && data.legalEntities.every(le => !le.blng__Active__c)) {
        issues.push({
          check_id: 'LE-003',
          category: 'legal_entity',
          severity: 'critical',
          title: 'All legal entities are inactive',
          description: `All ${inactive.length} legal entity(ies) in this org are inactive. At least one must be active for billing to function.`,
          impact: 'No invoices can be generated without an active legal entity.',
          recommendation: 'Activate at least one legal entity.',
          affected_records: inactive.map(le => ({
            id: le.Id,
            name: le.Name,
            type: 'blng__LegalEntity__c',
          })),
          effort_hours: 0.25,
        });
      }

      return issues;
    },
  },
];
