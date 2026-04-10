import { describe, it, expect } from 'vitest';
import { quoteTemplateChecks } from '@/lib/analysis/checks/quote-templates';
import { configurationAttributeChecks } from '@/lib/analysis/checks/configuration-attributes';
import { guidedSellingChecks } from '@/lib/analysis/checks/guided-selling';
import { createCleanData, createProblematicData } from './fixtures';

describe('Quote Template Checks', () => {
  describe('QT-001: No Default Quote Template', () => {
    const check = quoteTemplateChecks.find(c => c.id === 'QT-001')!;

    it('should NOT trigger when a default template exists', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when templates exist but none is default', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QT-001');
    });
  });

  describe('QT-003: Empty Quote Templates', () => {
    const check = quoteTemplateChecks.find(c => c.id === 'QT-003')!;

    it('should NOT trigger when templates have sections', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when template has no sections', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('QT-003');
    });
  });
});

describe('Configuration Attribute Checks', () => {
  describe('CA-001: Hidden Required Attributes', () => {
    const check = configurationAttributeChecks.find(c => c.id === 'CA-001')!;

    it('should NOT trigger when no hidden+required attributes', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when attribute is both required and hidden', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('CA-001');
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('CA-002: Attributes Without Target Field', () => {
    const check = configurationAttributeChecks.find(c => c.id === 'CA-002')!;

    it('should NOT trigger when all attributes have targets', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when attribute has no target field', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('CA-002');
    });
  });

  describe('CA-003: Duplicate Attribute Names', () => {
    const check = configurationAttributeChecks.find(c => c.id === 'CA-003')!;

    it('should NOT trigger when attribute names are unique per product', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when same product has duplicate attribute names', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('CA-003');
    });
  });

  describe('CA-004: Required Attributes Without Default', () => {
    const check = configurationAttributeChecks.find(c => c.id === 'CA-004')!;

    it('should NOT trigger when required visible attributes have defaults', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when required visible attribute has no default', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('CA-004');
    });
  });
});

describe('Guided Selling Checks', () => {
  describe('GS-001: Guided Selling Without Inputs', () => {
    const check = guidedSellingChecks.find(c => c.id === 'GS-001')!;

    it('should NOT trigger when processes have inputs', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active process has no inputs', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('GS-001');
    });
  });

  describe('GS-002: Guided Selling Without Outputs', () => {
    const check = guidedSellingChecks.find(c => c.id === 'GS-002')!;

    it('should NOT trigger when processes have outputs', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when active process has no outputs', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('GS-002');
    });
  });

  describe('GS-003: Inactive Guided Selling Processes', () => {
    const check = guidedSellingChecks.find(c => c.id === 'GS-003')!;

    it('should NOT trigger when all processes are active', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should trigger when inactive processes exist', async () => {
      const data = createProblematicData();
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].check_id).toBe('GS-003');
    });
  });
});
