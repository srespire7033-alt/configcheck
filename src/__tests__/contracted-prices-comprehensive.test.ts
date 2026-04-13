import { describe, it, expect } from 'vitest';
import { contractedPriceChecks } from '@/lib/analysis/checks/contracted-prices';
import { createCleanData } from './fixtures';

// Helper to get a specific check
const getCheck = (id: string) => contractedPriceChecks.find((c) => c.id === id)!;

describe('Contracted Prices — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // CP-001: Expired or Stale Contracted Prices
  // (3 sub-checks: expired, inactive product, zero price)
  // ═══════════════════════════════════════════════
  describe('CP-001: Expired Contracted Prices', () => {
    const check = getCheck('CP-001');

    // ── Negative tests (should NOT trigger) ──
    it('should pass with no contracted prices', async () => {
      const data = createCleanData();
      data.contractedPrices = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when all prices are valid (future expiry, active product, positive price)', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when price has no expiration date and product is active with positive price', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 50, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: null as unknown as string, SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with multiple valid contracted prices', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
        { Id: 'cp2', Name: 'CP-002', SBQQ__Account__c: 'acc2', SBQQ__Account__r: { Name: 'Beta Inc' }, SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B', IsActive: true }, SBQQ__Price__c: 250, SBQQ__EffectiveDate__c: '2025-06-01', SBQQ__ExpirationDate__c: '2029-06-01', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests: Expired sub-check ──
    it('should flag expired contracted prices (past expiration date)', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2020-01-01', SBQQ__ExpirationDate__c: '2022-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      const expiredIssue = issues.find((i) => i.title.includes('expired'));
      expect(expiredIssue).toBeDefined();
      expect(expiredIssue!.check_id).toBe('CP-001');
      expect(expiredIssue!.severity).toBe('warning');
      expect(expiredIssue!.affected_records[0].id).toBe('cp1');
    });

    it('should flag multiple expired contracted prices', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2019-01-01', SBQQ__ExpirationDate__c: '2020-12-31', SBQQ__OriginalQuoteLine__c: null },
        { Id: 'cp2', Name: 'CP-002', SBQQ__Account__c: 'acc2', SBQQ__Account__r: { Name: 'Beta Inc' }, SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Product B', IsActive: true }, SBQQ__Price__c: 200, SBQQ__EffectiveDate__c: '2019-06-01', SBQQ__ExpirationDate__c: '2021-06-30', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const expiredIssue = issues.find((i) => i.title.includes('expired'));
      expect(expiredIssue).toBeDefined();
      expect(expiredIssue!.title).toContain('2');
      expect(expiredIssue!.affected_records.length).toBe(2);
    });

    it('should include account and product name in affected records for expired', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Widget Pro', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2020-01-01', SBQQ__ExpirationDate__c: '2021-01-01', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const expiredIssue = issues.find((i) => i.title.includes('expired'));
      expect(expiredIssue).toBeDefined();
      expect(expiredIssue!.affected_records[0].name).toContain('Acme Corp');
      expect(expiredIssue!.affected_records[0].name).toContain('Widget Pro');
    });

    // ── Positive tests: Inactive product sub-check ──
    it('should flag contracted prices referencing inactive products', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Old Product', IsActive: false }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const inactiveIssue = issues.find((i) => i.title.includes('inactive'));
      expect(inactiveIssue).toBeDefined();
      expect(inactiveIssue!.check_id).toBe('CP-001');
      expect(inactiveIssue!.severity).toBe('warning');
      expect(inactiveIssue!.affected_records[0].id).toBe('cp1');
    });

    it('should flag multiple inactive product contracted prices', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Retired A', IsActive: false }, SBQQ__Price__c: 50, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
        { Id: 'cp2', Name: 'CP-002', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p2', SBQQ__Product__r: { Name: 'Retired B', IsActive: false }, SBQQ__Price__c: 75, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const inactiveIssue = issues.find((i) => i.title.includes('inactive'));
      expect(inactiveIssue).toBeDefined();
      expect(inactiveIssue!.title).toContain('2');
    });

    // ── Positive tests: Zero/null price sub-check ──
    it('should flag active contracted prices with zero price', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 0, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const zeroIssue = issues.find((i) => i.title.includes('zero or null'));
      expect(zeroIssue).toBeDefined();
      expect(zeroIssue!.check_id).toBe('CP-001');
      expect(zeroIssue!.severity).toBe('warning');
    });

    it('should flag active contracted prices with null price', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: null as unknown as number, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const zeroIssue = issues.find((i) => i.title.includes('zero or null'));
      expect(zeroIssue).toBeDefined();
    });

    it('should flag zero price when no expiration date is set', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 0, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: null as unknown as string, SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const zeroIssue = issues.find((i) => i.title.includes('zero or null'));
      expect(zeroIssue).toBeDefined();
    });

    it('should NOT flag zero price on already-expired contracted price', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 0, SBQQ__EffectiveDate__c: '2020-01-01', SBQQ__ExpirationDate__c: '2021-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      // Should get the expired issue but NOT the zero price issue
      const zeroIssue = issues.find((i) => i.title.includes('zero or null'));
      expect(zeroIssue).toBeUndefined();
    });

    it('should include revenue_impact on zero price issues', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 0, SBQQ__EffectiveDate__c: '2025-01-01', SBQQ__ExpirationDate__c: '2030-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      const zeroIssue = issues.find((i) => i.title.includes('zero or null'));
      expect(zeroIssue).toBeDefined();
      expect(zeroIssue!.revenue_impact).toBeDefined();
      expect(zeroIssue!.revenue_impact).toBeGreaterThan(0);
    });

    // ── Combined sub-check scenarios ──
    it('should produce multiple issues when record is expired AND has inactive product', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: { Name: 'Acme Corp' }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Dead Product', IsActive: false }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2019-01-01', SBQQ__ExpirationDate__c: '2020-12-31', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      expect(issues.length).toBeGreaterThanOrEqual(2);
      expect(issues.some((i) => i.title.includes('expired'))).toBe(true);
      expect(issues.some((i) => i.title.includes('inactive'))).toBe(true);
    });

    it('should handle missing Account__r gracefully', async () => {
      const data = createCleanData();
      data.contractedPrices = [
        { Id: 'cp1', Name: 'CP-001', SBQQ__Account__c: 'acc1', SBQQ__Account__r: null as unknown as { Name: string }, SBQQ__Product__c: 'p1', SBQQ__Product__r: { Name: 'Product A', IsActive: true }, SBQQ__Price__c: 100, SBQQ__EffectiveDate__c: '2020-01-01', SBQQ__ExpirationDate__c: '2022-01-01', SBQQ__OriginalQuoteLine__c: null },
      ];
      const issues = await check.run(data);
      // Should not crash — should still produce expired issue
      expect(issues.length).toBeGreaterThanOrEqual(1);
    });

    it('should limit affected records to 20', async () => {
      const data = createCleanData();
      data.contractedPrices = Array.from({ length: 25 }, (_, i) => ({
        Id: `cp${i}`,
        Name: `CP-${i}`,
        SBQQ__Account__c: 'acc1',
        SBQQ__Account__r: { Name: 'Acme Corp' },
        SBQQ__Product__c: `p${i}`,
        SBQQ__Product__r: { Name: `Product ${i}`, IsActive: true },
        SBQQ__Price__c: 100,
        SBQQ__EffectiveDate__c: '2019-01-01',
        SBQQ__ExpirationDate__c: '2020-12-31',
        SBQQ__OriginalQuoteLine__c: null,
      }));
      const issues = await check.run(data);
      const expiredIssue = issues.find((i) => i.title.includes('expired'));
      expect(expiredIssue).toBeDefined();
      expect(expiredIssue!.affected_records.length).toBeLessThanOrEqual(20);
    });
  });
});
