import type { HealthCheck, CPQData, Issue } from '@/types';

export const customScriptChecks: HealthCheck[] = [
  // QCP-001: Empty Quote Calculator Plugin
  {
    id: 'QCP-001',
    name: 'Empty Quote Calculator Plugin',
    category: 'quote_calculator_plugin',
    severity: 'critical',
    description: 'Custom script records with no code',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const script of data.customScripts) {
        if (!script.SBQQ__Code__c || script.SBQQ__Code__c.trim().length === 0) {
          issues.push({
            check_id: 'QCP-001',
            category: 'quote_calculator_plugin',
            severity: 'critical',
            title: `Custom script "${script.Name}" has no code`,
            description: `"${script.Name}" (Type: ${script.SBQQ__Type__c || 'Unknown'}) exists but contains no code. The script record is a shell with no logic.`,
            impact: 'CPQ loads this script during calculation but it does nothing. May cause unexpected behavior if CPQ expects callbacks.',
            recommendation: `Either add the JavaScript code to "${script.Name}" or delete the empty script record.`,
            affected_records: [{ id: script.Id, name: script.Name, type: 'SBQQ__CustomScript__c' }],
          });
        }
      }

      return issues;
    },
  },

  // QCP-002: QCP Without Transpiled Code
  {
    id: 'QCP-002',
    name: 'QCP Missing Transpiled Code',
    category: 'quote_calculator_plugin',
    severity: 'warning',
    description: 'QCP scripts with source code but no transpiled version',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const script of data.customScripts) {
        if (!script.SBQQ__Code__c || script.SBQQ__Code__c.trim().length === 0) continue;

        if (!script.SBQQ__TranspiledCode__c || script.SBQQ__TranspiledCode__c.trim().length === 0) {
          issues.push({
            check_id: 'QCP-002',
            category: 'quote_calculator_plugin',
            severity: 'warning',
            title: `Custom script "${script.Name}" missing transpiled code`,
            description: `"${script.Name}" has source code but no transpiled version. CPQ may not be able to execute this script in the quote calculator.`,
            impact: 'QCP logic may silently fail. Price calculations relying on this script will not execute.',
            recommendation: `Open "${script.Name}" in the CPQ Script Editor and click Save to auto-transpile, or manually transpile and paste into the Transpiled Code field.`,
            affected_records: [{ id: script.Id, name: script.Name, type: 'SBQQ__CustomScript__c' }],
          });
        }
      }

      return issues;
    },
  },

  // QCP-003: QCP Performance Warnings
  {
    id: 'QCP-003',
    name: 'QCP Performance Concerns',
    category: 'quote_calculator_plugin',
    severity: 'warning',
    description: 'QCP code with potential performance issues',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      for (const script of data.customScripts) {
        const code = script.SBQQ__Code__c;
        if (!code || code.trim().length === 0) continue;

        const warnings: string[] = [];

        // Check for nested loops
        const forLoopCount = (code.match(/\bfor\s*\(/g) || []).length;
        const whileLoopCount = (code.match(/\bwhile\s*\(/g) || []).length;
        const totalLoops = forLoopCount + whileLoopCount;
        if (totalLoops >= 3) {
          warnings.push(`${totalLoops} loops detected — potential nested loop performance issue`);
        }

        // Check code size
        const lineCount = code.split('\n').length;
        if (lineCount > 500) {
          warnings.push(`${lineCount} lines of code — large QCP may slow quote calculation`);
        }

        // Check for console.log (debug artifacts)
        const consoleLogCount = (code.match(/console\.(log|debug|info|warn|error)/g) || []).length;
        if (consoleLogCount > 5) {
          warnings.push(`${consoleLogCount} console statements — debug code left in production`);
        }

        if (warnings.length > 0) {
          issues.push({
            check_id: 'QCP-003',
            category: 'quote_calculator_plugin',
            severity: 'warning',
            title: `Performance concerns in "${script.Name}"`,
            description: `"${script.Name}" has potential performance issues: ${warnings.join('; ')}.`,
            impact: 'Slow quote calculation times. Users experience long waits when saving or calculating quotes.',
            recommendation: 'Review the script for optimization opportunities. Minimize loops, reduce code size, and remove debug statements.',
            affected_records: [{ id: script.Id, name: script.Name, type: 'SBQQ__CustomScript__c' }],
          });
        }
      }

      return issues;
    },
  },

  // QCP-004: Multiple QCP Scripts
  {
    id: 'QCP-004',
    name: 'Multiple QCP Scripts',
    category: 'quote_calculator_plugin',
    severity: 'info',
    description: 'More than one custom script record exists',
    run: async (data: CPQData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const qcps = data.customScripts.filter((s) => s.SBQQ__Type__c === 'Quote Calculator Plugin');

      if (qcps.length > 1) {
        issues.push({
          check_id: 'QCP-004',
          category: 'quote_calculator_plugin',
          severity: 'info',
          title: `${qcps.length} Quote Calculator Plugin scripts found`,
          description: `There are ${qcps.length} QCP script records: ${qcps.map((s) => `"${s.Name}"`).join(', ')}. CPQ only uses one active QCP — having multiple can cause confusion about which code is actually running.`,
          impact: 'Admins may edit the wrong script. Only the script linked in CPQ Settings is active.',
          recommendation: 'Keep only one active QCP. Archive or delete unused script records to avoid confusion.',
          affected_records: qcps.map((s) => ({
            id: s.Id,
            name: s.Name,
            type: 'SBQQ__CustomScript__c',
          })),
        });
      }

      return issues;
    },
  },
];
