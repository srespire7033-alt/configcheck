'use client';

import { useState } from 'react';
import { X, Sparkles, AlertTriangle, Zap, Loader2, CheckCircle2, ExternalLink, AlertCircle, Info as InfoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DBIssue } from '@/types';

interface IssueDetailModalProps {
  issue: DBIssue;
  instanceUrl?: string;
  onClose: () => void;
  onStatusChange?: (issueId: string, status: string) => void;
}

export function IssueDetailModal({ issue: initialIssue, instanceUrl, onClose, onStatusChange }: IssueDetailModalProps) {
  const [issue, setIssue] = useState(initialIssue);
  const [generatingFix, setGeneratingFix] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [applyingFix, setApplyingFix] = useState(false);
  const [fixResult, setFixResult] = useState<{ success: boolean; details: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'fix'>('details');

  const severityConfig = {
    critical: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900/30' },
    warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    info: { icon: InfoIcon, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  };
  const sev = severityConfig[issue.severity] || severityConfig.info;
  const SevIcon = sev.icon;

  async function handleGenerateFix() {
    setGeneratingFix(true);
    setFixError(null);
    try {
      const res = await fetch('/api/ai/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFixError(data.error || 'Failed to generate fix suggestion.');
        return;
      }
      setIssue((prev) => ({ ...prev, ai_fix_suggestion: data.suggestion }));
    } catch {
      setFixError('Network error. Please try again.');
    } finally {
      setGeneratingFix(false);
    }
  }

  function getAvailableFixes() {
    const fixes: { fixType: string; label: string; description: string }[] = [];
    const checkId = issue.check_id;

    if (['PR-001', 'PR-002', 'PR-003', 'PR-004', 'PR-005', 'IA-001', 'IA-002'].includes(checkId)) {
      if (issue.affected_records?.length > 0) {
        fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s)` });
      }
      fixes.push({ fixType: 'resequence_price_rules', label: 'Resequence Price Rules', description: 'Assign clean evaluation order to all active price rules' });
    }
    if (['PRD-001', 'PRD-002', 'PRD-003', 'PRD-004'].includes(checkId)) {
      if (issue.affected_records?.length > 0) {
        fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s)` });
      }
      fixes.push({ fixType: 'resequence_product_rules', label: 'Resequence Product Rules', description: 'Assign clean evaluation order to all active product rules' });
    }
    if (['DS-001', 'DS-002', 'DS-003', 'DS-004'].includes(checkId)) {
      fixes.push({ fixType: 'fix_tier_gaps', label: 'Fix Tier Gaps', description: 'Automatically close gaps between discount tier bounds' });
    }
    if (checkId === 'UA-003') {
      fixes.push({ fixType: 'deactivate_inactive_rules', label: 'Remove Inactive Rules', description: 'Delete all inactive price and product rules' });
    }
    if (['PERF-001', 'PERF-002'].includes(checkId) && issue.affected_records?.length > 0) {
      fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s)` });
    }
    return fixes;
  }

  async function handleApplyFix(fixType: string) {
    setShowConfirm(null);
    setApplyingFix(true);
    setFixResult(null);
    try {
      const recordIds = issue.affected_records?.map((r) => r.id) || [];
      const res = await fetch('/api/salesforce/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: issue.organization_id, issueId: issue.id, fixType, recordIds }),
      });
      const data = await res.json();
      if (res.ok) {
        setFixResult({ success: data.success, details: data.details });
        if (data.success) {
          setIssue((prev) => ({ ...prev, status: 'resolved' }));
          onStatusChange?.(issue.id, 'resolved');
        }
      } else {
        setFixResult({ success: false, details: data.error || 'Fix failed' });
      }
    } catch {
      setFixResult({ success: false, details: 'Network error. Please try again.' });
    } finally {
      setApplyingFix(false);
    }
  }

  function handleStatusChange(status: string) {
    onStatusChange?.(issue.id, status);
    setIssue((prev) => ({ ...prev, status: status as DBIssue['status'] }));
  }

  const isResolved = issue.status === 'resolved' || issue.status === 'ignored';
  const availableFixes = getAvailableFixes();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/60 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className={`w-10 h-10 ${sev.bg} rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5`}>
            <SevIcon className={`w-5 h-5 ${sev.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={issue.severity}>{issue.severity}</Badge>
              <span className="text-xs font-mono text-gray-400">{issue.check_id}</span>
              {!isResolved && (
                <select
                  value={issue.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="ml-auto px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-300"
                >
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                  <option value="ignored">Ignored</option>
                </select>
              )}
              {isResolved && (
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium rounded-full">
                  <CheckCircle2 className="w-3 h-3" />
                  {issue.status === 'resolved' ? 'Resolved' : 'Ignored'}
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{issue.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'details'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Issue Details
          </button>
          <button
            onClick={() => setActiveTab('fix')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-1.5 ${
              activeTab === 'fix'
                ? 'text-purple-600 dark:text-purple-400 border-b-2 border-purple-600 dark:border-purple-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Fix & Remediation
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {activeTab === 'details' ? (
            <div className="space-y-5">
              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">What&apos;s Wrong</h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{issue.description}</p>
              </div>

              {/* Impact */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Why It Matters</h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{issue.impact}</p>
              </div>

              {/* Recommendation */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Recommendation</h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{issue.recommendation}</p>
              </div>

              {/* Affected Records */}
              {issue.affected_records && issue.affected_records.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Affected Records ({issue.affected_records.length})
                  </h4>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-2">
                    {issue.affected_records.map((record, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{record.type}</span>
                        <span className="text-gray-700 dark:text-gray-300">{record.name}</span>
                        {instanceUrl && (
                          <a
                            href={`${instanceUrl}/lightning/r/${record.type}/${record.id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 ml-auto"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Revenue impact */}
              {issue.revenue_impact && issue.revenue_impact > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-xl p-4">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Estimated revenue at risk: <span className="text-lg font-bold">₹{issue.revenue_impact.toLocaleString()}</span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* AI Fix Suggestion */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Fix Suggestion</h4>
                  </div>
                  {!issue.ai_fix_suggestion && !generatingFix && (
                    <button
                      onClick={handleGenerateFix}
                      className="px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition"
                    >
                      Generate Fix
                    </button>
                  )}
                </div>
                {generatingFix ? (
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-purple-700 dark:text-purple-300">Generating AI fix suggestion...</span>
                  </div>
                ) : issue.ai_fix_suggestion ? (
                  <div className="bg-purple-50 dark:bg-purple-900/10 rounded-xl p-4 border border-purple-100 dark:border-purple-800/50">
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">{issue.ai_fix_suggestion}</p>
                  </div>
                ) : fixError ? (
                  <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>{fixError}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">Click &quot;Generate Fix&quot; for a detailed, step-by-step AI fix guide.</p>
                )}
              </div>

              {/* One-Click Fixes */}
              {availableFixes.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">One-Click Fixes</h4>
                  </div>

                  {fixResult && (
                    <div className={`mb-3 p-3 rounded-xl flex items-start gap-2 ${fixResult.success ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
                      {fixResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <p className={`text-sm ${fixResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                        {fixResult.details}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {availableFixes.map((fix) => (
                      <div key={fix.fixType} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{fix.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{fix.description}</p>
                        </div>
                        {showConfirm === fix.fixType ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setShowConfirm(null)}
                              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleApplyFix(fix.fixType)}
                              disabled={applyingFix}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition disabled:opacity-50 flex items-center gap-1"
                            >
                              {applyingFix ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              Confirm
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowConfirm(fix.fixType)}
                            disabled={applyingFix || isResolved}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition disabled:opacity-50 flex items-center gap-1"
                          >
                            <Zap className="w-3 h-3" />
                            Apply
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    These actions modify your Salesforce org directly.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 flex-shrink-0">
          {!isResolved ? (
            <button
              onClick={() => handleStatusChange('resolved')}
              className="px-4 py-2 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg text-sm font-medium hover:bg-green-100 dark:hover:bg-green-900/50 transition flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Fixed
            </button>
          ) : (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Resolved
            </span>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
