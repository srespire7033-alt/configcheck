import { describe, it, expect } from 'vitest';
import { legalEntityChecks } from '@/lib/analysis/billing-checks/legal-entity';
import { createCleanBillingData } from './billing-fixtures';

const getCheck = (id: string) => legalEntityChecks.find((c) => c.id === id)!;

describe('Legal Entity — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // LE-001: No Legal Entity Defined
  // ═══════════════════════════════════════════════
  describe('LE-001: No Legal Entity Defined', () => {
    const check = getCheck('LE-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when one legal entity exists', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Corp A', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when multiple legal entities exist', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Corp A', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'Corp B', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass even when all entities are inactive (only checks existence)', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Inactive', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when legalEntities array is empty', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('LE-001');
      expect(issues[0].affected_records).toHaveLength(0);
    });

    it('should include correct description text', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('No legal entities found');
    });

    it('should have effort_hours set', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [];
      const issues = await check.run(data);
      expect(issues[0].effort_hours).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════
  // LE-002: Legal Entity Missing Address
  // ═══════════════════════════════════════════════
  describe('LE-002: Legal Entity Missing Address', () => {
    const check = getCheck('LE-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all active entities have complete addresses', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Corp A', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'Corp B', blng__Active__c: true, blng__Street__c: '2 Ave', blng__City__c: 'NYC', blng__State__c: 'NY', blng__PostalCode__c: '10001', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when inactive entity has missing address', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Inactive', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty legalEntities array', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when state and postal code are null but street, city, country set', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Corp', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag active entity missing street', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'No Street', blng__Active__c: true, blng__Street__c: null, blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].check_id).toBe('LE-002');
      expect(issues[0].affected_records[0].id).toBe('le1');
    });

    it('should flag active entity missing city', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'No City', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: null, blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('le1');
    });

    it('should flag active entity missing country', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'No Country', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag active entity missing all address fields', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'No Address', blng__Active__c: true, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(1);
    });

    it('should flag multiple active entities with missing addresses', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'No Street', blng__Active__c: true, blng__Street__c: null, blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'No City', blng__Active__c: true, blng__Street__c: '2 Ave', blng__City__c: null, blng__State__c: 'NY', blng__PostalCode__c: '10001', blng__Country__c: 'US' },
        { Id: 'le3', Name: 'Complete', blng__Active__c: true, blng__Street__c: '3 Rd', blng__City__c: 'LA', blng__State__c: 'CA', blng__PostalCode__c: '90001', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should include correct count in description', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'A', blng__Active__c: true, blng__Street__c: null, blng__City__c: 'SF', blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('1');
    });
  });

  // ═══════════════════════════════════════════════
  // LE-003: All Legal Entities Inactive
  // ═══════════════════════════════════════════════
  describe('LE-003: All Legal Entities Inactive', () => {
    const check = getCheck('LE-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with clean data defaults', async () => {
      const data = createCleanBillingData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all entities are active', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Active A', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'Active B', blng__Active__c: true, blng__Street__c: '2 Ave', blng__City__c: 'NYC', blng__State__c: 'NY', blng__PostalCode__c: '10001', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty legalEntities array (caught by LE-001)', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when mix of active and inactive (not all inactive)', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Active', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'Inactive', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should NOT trigger when majority inactive but at least one active', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Active', blng__Active__c: true, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
        { Id: 'le2', Name: 'Inactive 1', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
        { Id: 'le3', Name: 'Inactive 2', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
        { Id: 'le4', Name: 'Inactive 3', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag when single entity is inactive', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Only Entity', blng__Active__c: false, blng__Street__c: '1 St', blng__City__c: 'SF', blng__State__c: 'CA', blng__PostalCode__c: '94105', blng__Country__c: 'US' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('LE-003');
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('le1');
    });

    it('should flag when all multiple entities are inactive', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Inactive A', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
        { Id: 'le2', Name: 'Inactive B', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
        { Id: 'le3', Name: 'Inactive C', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should escalate severity to critical when all inactive', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Inactive', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].severity).toBe('critical');
    });

    it('should include correct count in description', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'A', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
        { Id: 'le2', Name: 'B', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('2');
    });

    it('should have effort_hours of 0.25', async () => {
      const data = createCleanBillingData();
      data.legalEntities = [
        { Id: 'le1', Name: 'Inactive', blng__Active__c: false, blng__Street__c: null, blng__City__c: null, blng__State__c: null, blng__PostalCode__c: null, blng__Country__c: null },
      ];
      const issues = await check.run(data);
      expect(issues[0].effort_hours).toBe(0.25);
    });
  });
});
