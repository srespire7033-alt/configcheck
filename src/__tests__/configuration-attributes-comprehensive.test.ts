import { describe, it, expect } from 'vitest';
import { configurationAttributeChecks } from '@/lib/analysis/checks/configuration-attributes';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => configurationAttributeChecks.find((c) => c.id === id)!;

// Helper to create a config attribute with defaults
function makeAttr(overrides: Record<string, unknown> = {}) {
  return {
    Id: 'ca-default',
    Name: 'Default Attr',
    SBQQ__Product__c: 'p1',
    SBQQ__Product__r: { Name: 'Product A' },
    SBQQ__TargetField__c: 'SomeField__c',
    SBQQ__Required__c: false,
    SBQQ__Hidden__c: false,
    SBQQ__DefaultField__c: null as string | null,
    SBQQ__ColumnOrder__c: 1,
    SBQQ__DisplayOrder__c: 1,
    SBQQ__Feature__c: null,
    SBQQ__AppliedImmediately__c: false,
    ...overrides,
  };
}

describe('Configuration Attributes — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // CA-001: Hidden and Required Attributes
  // ═══════════════════════════════════════════════
  describe('CA-001: Hidden Required Configuration Attributes', () => {
    const check = getCheck('CA-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with no configuration attributes', async () => {
      const data = createCleanData();
      data.configurationAttributes = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when attribute is required but NOT hidden', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Required__c: true, SBQQ__Hidden__c: false }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when attribute is hidden but NOT required', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Internal Flag', SBQQ__Required__c: false, SBQQ__Hidden__c: true }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when attribute is neither required nor hidden', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Optional Field', SBQQ__Required__c: false, SBQQ__Hidden__c: false }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag attribute that is both required and hidden', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Bad Attr', SBQQ__Required__c: true, SBQQ__Hidden__c: true }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('CA-001');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].title).toContain('Bad Attr');
      expect(issues[0].title).toContain('hidden');
      expect(issues[0].title).toContain('required');
      expect(issues[0].affected_records[0].id).toBe('ca1');
    });

    it('should flag multiple hidden+required attributes individually', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Hidden Req 1', SBQQ__Required__c: true, SBQQ__Hidden__c: true }),
        makeAttr({ Id: 'ca2', Name: 'Hidden Req 2', SBQQ__Required__c: true, SBQQ__Hidden__c: true, SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B' } }),
        makeAttr({ Id: 'ca3', Name: 'Normal Attr', SBQQ__Required__c: false, SBQQ__Hidden__c: false }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      expect(issues[0].affected_records).toHaveLength(1);
      expect(issues[1].affected_records).toHaveLength(1);
    });

    it('should include product name in description', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Broken', SBQQ__Required__c: true, SBQQ__Hidden__c: true, SBQQ__Product__r: { Name: 'Enterprise Bundle' } }),
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('Enterprise Bundle');
    });
  });

  // ═══════════════════════════════════════════════
  // CA-002: Attributes Without Target Field
  // ═══════════════════════════════════════════════
  describe('CA-002: Configuration Attributes Missing Target Field', () => {
    const check = getCheck('CA-002');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all attributes have target fields', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__TargetField__c: 'Color__c' }),
        makeAttr({ Id: 'ca2', Name: 'Size', SBQQ__TargetField__c: 'Size__c' }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty attributes array', async () => {
      const data = createCleanData();
      data.configurationAttributes = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag attributes with null target field', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Orphan Attr', SBQQ__TargetField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('CA-002');
      expect(issues[0].severity).toBe('warning');
    });

    it('should flag attributes with empty string target field', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Empty Target', SBQQ__TargetField__c: '' }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should group missing-target attributes by product', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Attr A', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__TargetField__c: null }),
        makeAttr({ Id: 'ca2', Name: 'Attr B', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__TargetField__c: null }),
        makeAttr({ Id: 'ca3', Name: 'Attr C', SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B' }, SBQQ__TargetField__c: null }),
      ];
      const issues = await check.run(data);
      // Should be 2 issues: one for Product A (2 attrs), one for Product B (1 attr)
      expect(issues).toHaveLength(2);
      const prodAIssue = issues.find((i) => i.title.includes('Product A'));
      expect(prodAIssue!.affected_records).toHaveLength(2);
    });

    it('should not flag attributes that have a valid target field', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'With Target', SBQQ__TargetField__c: 'MyField__c' }),
        makeAttr({ Id: 'ca2', Name: 'Without Target', SBQQ__TargetField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records[0].id).toBe('ca2');
    });
  });

  // ═══════════════════════════════════════════════
  // CA-003: Duplicate Attribute Names on Same Product
  // ═══════════════════════════════════════════════
  describe('CA-003: Duplicate Configuration Attribute Names', () => {
    const check = getCheck('CA-003');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when all attribute names are unique per product', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1' }),
        makeAttr({ Id: 'ca2', Name: 'Size', SBQQ__Product__c: 'p1' }),
        makeAttr({ Id: 'ca3', Name: 'Weight', SBQQ__Product__c: 'p1' }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when same name exists on different products', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
        makeAttr({ Id: 'ca2', Name: 'Color', SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B' } }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty attributes', async () => {
      const data = createCleanData();
      data.configurationAttributes = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with single attribute per product', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1' }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag duplicate attribute names on the same product', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
        makeAttr({ Id: 'ca2', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('CA-003');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Color');
      expect(issues[0].title).toContain('Product A');
      expect(issues[0].affected_records).toHaveLength(2);
    });

    it('should flag triple duplicates', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Size', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Bundle X' } }),
        makeAttr({ Id: 'ca2', Name: 'Size', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Bundle X' } }),
        makeAttr({ Id: 'ca3', Name: 'Size', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Bundle X' } }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('3');
      expect(issues[0].affected_records).toHaveLength(3);
    });

    it('should produce separate issues for different duplicate groups', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
        makeAttr({ Id: 'ca2', Name: 'Color', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
        makeAttr({ Id: 'ca3', Name: 'Size', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
        makeAttr({ Id: 'ca4', Name: 'Size', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' } }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // CA-004: Required Attributes Without Default
  // ═══════════════════════════════════════════════
  describe('CA-004: Required Attributes Without Default Value', () => {
    const check = getCheck('CA-004');

    // ── Negative tests (should NOT trigger) ──
    it('should pass when required attribute has a default field', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Color', SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: 'Default_Color__c' }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when attribute is not required', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Optional', SBQQ__Required__c: false, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should exclude hidden attributes (already caught by CA-001)', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Hidden Req', SBQQ__Required__c: true, SBQQ__Hidden__c: true, SBQQ__DefaultField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty attributes', async () => {
      const data = createCleanData();
      data.configurationAttributes = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests (should trigger) ──
    it('should flag required, visible attribute with no default', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Mandatory Field', SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].check_id).toBe('CA-004');
      expect(issues[0].severity).toBe('info');
    });

    it('should group by product', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Field A', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
        makeAttr({ Id: 'ca2', Name: 'Field B', SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A' }, SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
        makeAttr({ Id: 'ca3', Name: 'Field C', SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B' }, SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
      const prodAIssue = issues.find((i) => i.title.includes('Product A'));
      expect(prodAIssue!.title).toContain('2');
      expect(prodAIssue!.affected_records).toHaveLength(2);
    });

    it('should include attribute names in description', async () => {
      const data = createCleanData();
      data.configurationAttributes = [
        makeAttr({ Id: 'ca1', Name: 'Deployment Region', SBQQ__Required__c: true, SBQQ__Hidden__c: false, SBQQ__DefaultField__c: null }),
      ];
      const issues = await check.run(data);
      expect(issues[0].description).toContain('Deployment Region');
    });
  });
});
