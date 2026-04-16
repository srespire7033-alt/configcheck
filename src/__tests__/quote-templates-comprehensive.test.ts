import { describe, it, expect } from 'vitest';
import { quoteTemplateChecks } from '@/lib/analysis/checks/quote-templates';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => quoteTemplateChecks.find((c) => c.id === id)!;

describe('Quote Templates — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // QT-001: No Default Quote Template
  // ═══════════════════════════════════════════════
  describe('QT-001: No Default Quote Template', () => {
    const check = getCheck('QT-001');

    // ── Negative tests ──
    it('should pass when a default template exists', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when no templates exist at all (nothing to default)', async () => {
      const data = createCleanData();
      data.quoteTemplates = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when one of many templates is default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Primary', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt2', Name: 'Secondary', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts2', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt3', Name: 'Tertiary', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Draft', SBQQ__TemplateSections__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when single template exists but is not default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Lone Template', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('No default');
    });

    it('should flag when multiple templates exist but none is default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Template A', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt2', Name: 'Template B', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts2', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // QT-002: Non-Active Quote Templates
  // ═══════════════════════════════════════════════
  describe('QT-002: Non-Active Quote Templates', () => {
    const check = getCheck('QT-002');

    // ── Negative tests ──
    it('should pass when all templates are Active', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty templates array', async () => {
      const data = createCleanData();
      data.quoteTemplates = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when status is null (not set)', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'No Status', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: null as unknown as string, SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag template in Draft status', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Draft Template', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Draft', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].check_id).toBe('QT-002');
      expect(issues[0].description).toContain('Draft');
    });

    it('should flag template in Inactive status', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Inactive Template', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Inactive', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag multiple non-active templates in one issue', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Active One', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt2', Name: 'Draft One', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Draft', SBQQ__TemplateSections__r: { records: [] } },
        { Id: 'qt3', Name: 'Inactive One', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Inactive', SBQQ__TemplateSections__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].title).toContain('2 non-active');
    });
  });

  // ═══════════════════════════════════════════════
  // QT-003: Empty Quote Templates (no sections)
  // ═══════════════════════════════════════════════
  describe('QT-003: Empty Quote Templates', () => {
    const check = getCheck('QT-003');

    // ── Negative tests ──
    it('should pass when template has sections', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when template has multiple sections', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Rich Template', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [
          { Id: 'ts1', Name: 'Header', SBQQ__Content__c: '<h1>Quote</h1>' },
          { Id: 'ts2', Name: 'Line Items', SBQQ__Content__c: '<table>' },
          { Id: 'ts3', Name: 'Terms', SBQQ__Content__c: '<p>Terms</p>' },
        ] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty templates array', async () => {
      const data = createCleanData();
      data.quoteTemplates = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag template with empty sections array', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Blank Template', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Blank Template');
    });

    it('should flag template with null sections', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Null Sections', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: null as unknown as { records: [] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag each empty template separately', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Empty A', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [] } },
        { Id: 'qt2', Name: 'Empty B', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [] } },
        { Id: 'qt3', Name: 'Has Sections', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // QT-004: Multiple Default Templates
  // ═══════════════════════════════════════════════
  describe('QT-004: Multiple Default Templates', () => {
    const check = getCheck('QT-004');

    // ── Negative tests ──
    it('should pass when only one template is default', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when no templates are default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Not Default', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty templates', async () => {
      const data = createCleanData();
      data.quoteTemplates = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with single default among many', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Default One', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt2', Name: 'Non Default A', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts2', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt3', Name: 'Non Default B', SBQQ__Default__c: false, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts3', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when 2 templates are both default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Default A', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'content' }] } },
        { Id: 'qt2', Name: 'Default B', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts2', Name: 'Body', SBQQ__Content__c: 'content' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].title).toContain('2 templates');
    });

    it('should flag when 3 templates are all default', async () => {
      const data = createCleanData();
      data.quoteTemplates = [
        { Id: 'qt1', Name: 'Def 1', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts1', Name: 'Body', SBQQ__Content__c: 'c' }] } },
        { Id: 'qt2', Name: 'Def 2', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts2', Name: 'Body', SBQQ__Content__c: 'c' }] } },
        { Id: 'qt3', Name: 'Def 3', SBQQ__Default__c: true, SBQQ__DeploymentStatus__c: 'Deployed', SBQQ__TemplateSections__r: { records: [{ Id: 'ts3', Name: 'Body', SBQQ__Content__c: 'c' }] } },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3);
      expect(issues[0].title).toContain('3 templates');
    });
  });
});
