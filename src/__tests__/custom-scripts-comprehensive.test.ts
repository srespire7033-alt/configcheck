import { describe, it, expect } from 'vitest';
import { customScriptChecks } from '@/lib/analysis/checks/custom-scripts';
import { createCleanData } from './fixtures';

const getCheck = (id: string) => customScriptChecks.find((c) => c.id === id)!;

describe('Custom Scripts (QCP) — Comprehensive Tests', () => {
  // ═══════════════════════════════════════════════
  // QCP-001: Empty Quote Calculator Plugin
  // ═══════════════════════════════════════════════
  describe('QCP-001: Empty Quote Calculator Plugin', () => {
    const check = getCheck('QCP-001');

    // ── Negative tests ──
    it('should pass when script has code', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with empty scripts array', async () => {
      const data = createCleanData();
      data.customScripts = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when script has minimal code', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Minimal', SBQQ__Code__c: 'return;', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag script with null code', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Null Code', SBQQ__Code__c: null as unknown as string, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].check_id).toBe('QCP-001');
    });

    it('should flag script with empty string code', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Empty String', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag script with whitespace-only code', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Whitespace', SBQQ__Code__c: '   \n  \t  ', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag multiple empty scripts individually', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Empty A', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
        { Id: 'cs2', Name: 'Empty B', SBQQ__Code__c: null as unknown as string, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  // QCP-002: QCP Missing Transpiled Code
  // ═══════════════════════════════════════════════
  describe('QCP-002: QCP Missing Transpiled Code', () => {
    const check = getCheck('QCP-002');

    // ── Negative tests ──
    it('should pass when script has both code and transpiled code', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip empty scripts (QCP-001 handles those)', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'No Code', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip whitespace-only code scripts', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Whitespace Only', SBQQ__Code__c: '   ', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag script with code but null transpiled', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Not Transpiled', SBQQ__Code__c: 'export function onAfterCalculate(q, l) { return l; }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].title).toContain('Not Transpiled');
    });

    it('should flag script with code but empty string transpiled', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Empty Transpiled', SBQQ__Code__c: 'export function onInit() {}', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: '' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });

    it('should flag script with code but whitespace transpiled', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Whitespace Transpiled', SBQQ__Code__c: 'export function onAfterCalculate(q, l) { return l; }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: '   ' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // QCP-003: QCP Performance Concerns
  // ═══════════════════════════════════════════════
  describe('QCP-003: QCP Performance Concerns', () => {
    const check = getCheck('QCP-003');

    // ── Negative tests ──
    it('should pass when code is clean and simple', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 2 loops (under threshold of 3)', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Two Loops', SBQQ__Code__c: 'for (var i = 0; i < 10; i++) { } for (var j = 0; j < 10; j++) { }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with 5 console.log statements (threshold is >5)', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Some Logs', SBQQ__Code__c: 'console.log(1);\nconsole.log(2);\nconsole.log(3);\nconsole.log(4);\nconsole.log(5);', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with short code (under 500 lines)', async () => {
      const data = createCleanData();
      const shortCode = Array.from({ length: 100 }, (_, i) => `var x${i} = ${i};`).join('\n');
      data.customScripts = [
        { Id: 'cs1', Name: 'Short Code', SBQQ__Code__c: shortCode, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should skip empty code scripts', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Empty', SBQQ__Code__c: '', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: null },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag script with 3+ nested loops', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Loop Heavy', SBQQ__Code__c: 'for (var i=0; i<10; i++) { for (var j=0; j<10; j++) { for (var k=0; k<10; k++) { } } }', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].description).toContain('3 loops');
    });

    it('should flag script with 500+ lines', async () => {
      const data = createCleanData();
      const longCode = Array.from({ length: 510 }, (_, i) => `var x${i} = ${i};`).join('\n');
      data.customScripts = [
        { Id: 'cs1', Name: 'Long Script', SBQQ__Code__c: longCode, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('510 lines');
    });

    it('should flag script with >5 console statements', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Debug Mess', SBQQ__Code__c: 'console.log(1);\nconsole.log(2);\nconsole.debug(3);\nconsole.info(4);\nconsole.warn(5);\nconsole.error(6);', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('6 console');
    });

    it('should flag script with while loops counting toward total', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'Mixed Loops', SBQQ__Code__c: 'for (var i=0;i<10;i++){} while(true){} while(x>0){}', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('3 loops');
    });

    it('should detect multiple performance issues in same script', async () => {
      const data = createCleanData();
      const longCodeWithIssues = Array.from({ length: 510 }, (_, i) => `console.log(${i});`).join('\n') + '\nfor(;;){}\nfor(;;){}\nfor(;;){}';
      data.customScripts = [
        { Id: 'cs1', Name: 'Everything Wrong', SBQQ__Code__c: longCodeWithIssues, SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      // Single issue with multiple warnings in description
      expect(issues[0].description).toContain('loops');
      expect(issues[0].description).toContain('lines');
      expect(issues[0].description).toContain('console');
    });
  });

  // ═══════════════════════════════════════════════
  // QCP-004: Multiple QCP Scripts
  // ═══════════════════════════════════════════════
  describe('QCP-004: Multiple QCP Scripts', () => {
    const check = getCheck('QCP-004');

    // ── Negative tests ──
    it('should pass with single QCP', async () => {
      const data = createCleanData();
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass with no scripts', async () => {
      const data = createCleanData();
      data.customScripts = [];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    it('should pass when multiple scripts exist but only one is QCP type', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'QCP Main', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
        { Id: 'cs2', Name: 'Custom Action', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Custom Action', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(0);
    });

    // ── Positive tests ──
    it('should flag when 2 QCP scripts exist', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'QCP Main', SBQQ__Code__c: 'code1', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled1' },
        { Id: 'cs2', Name: 'QCP Backup', SBQQ__Code__c: 'code2', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'compiled2' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('info');
      expect(issues[0].affected_records).toHaveLength(2);
      expect(issues[0].title).toContain('2 Quote Calculator Plugin');
    });

    it('should flag when 3 QCPs exist (including one non-QCP)', async () => {
      const data = createCleanData();
      data.customScripts = [
        { Id: 'cs1', Name: 'QCP 1', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'c' },
        { Id: 'cs2', Name: 'QCP 2', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'c' },
        { Id: 'cs3', Name: 'QCP 3', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Quote Calculator Plugin', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'c' },
        { Id: 'cs4', Name: 'Other Script', SBQQ__Code__c: 'code', SBQQ__Type__c: 'Custom Action', SBQQ__GroupFields__c: null, SBQQ__QuoteFields__c: null, SBQQ__QuoteLineFields__c: null, SBQQ__TranspiledCode__c: 'c' },
      ];
      const issues = await check.run(data);
      expect(issues).toHaveLength(1);
      expect(issues[0].affected_records).toHaveLength(3); // Only QCPs, not the Custom Action
      expect(issues[0].title).toContain('3');
    });
  });
});
