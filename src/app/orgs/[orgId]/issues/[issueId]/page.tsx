'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, ExternalLink, Zap, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DBIssue, DBOrganization } from '@/types';

export default function IssueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;
  const issueId = params.issueId as string;

  const [issue, setIssue] = useState<DBIssue | null>(null);
  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingFix, setGeneratingFix] = useState(false);
  const [applyingFix, setApplyingFix] = useState(false);
  const [fixResult, setFixResult] = useState<{ success: boolean; details: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  async function fetchData() {
    try {
      const [issueRes, orgRes] = await Promise.all([
        fetch(`/api/issues?issueId=${issueId}`),
        fetch(`/api/orgs?orgId=${orgId}`),
      ]);

      if (issueRes.ok) setIssue(await issueRes.json());
      if (orgRes.ok) setOrg(await orgRes.json());
    } catch (error) {
      console.error('Failed to fetch:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFix() {
    setGeneratingFix(true);
    try {
      const res = await fetch('/api/ai/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });
      const { suggestion } = await res.json();
      setIssue((prev) => prev ? { ...prev, ai_fix_suggestion: suggestion } : null);
    } catch (error) {
      console.error('Failed to generate fix:', error);
    } finally {
      setGeneratingFix(false);
    }
  }

  // Determine which one-click fixes are available based on check_id
  function getAvailableFixes(): { fixType: string; label: string; description: string }[] {
    if (!issue) return [];
    const fixes: { fixType: string; label: string; description: string }[] = [];
    const checkId = issue.check_id;

    // Price rule issues — offer deactivation and resequencing
    if (['PR-001', 'PR-002', 'PR-003', 'PR-004', 'PR-005', 'IA-001', 'IA-002'].includes(checkId)) {
      if (issue.affected_records?.length > 0) {
        fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s) in Salesforce` });
      }
      fixes.push({ fixType: 'resequence_price_rules', label: 'Resequence Price Rules', description: 'Assign clean evaluation order (10, 20, 30...) to all active price rules' });
    }

    // Product rule issues
    if (['PRD-001', 'PRD-002', 'PRD-003', 'PRD-004'].includes(checkId)) {
      if (issue.affected_records?.length > 0) {
        fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s) in Salesforce` });
      }
      fixes.push({ fixType: 'resequence_product_rules', label: 'Resequence Product Rules', description: 'Assign clean evaluation order (10, 20, 30...) to all active product rules' });
    }

    // Discount tier issues
    if (['DS-001', 'DS-002', 'DS-003', 'DS-004'].includes(checkId)) {
      fixes.push({ fixType: 'fix_tier_gaps', label: 'Fix Tier Gaps', description: 'Automatically close gaps between discount tier bounds' });
    }

    // Stale rules (usage analytics)
    if (checkId === 'UA-003') {
      fixes.push({ fixType: 'deactivate_inactive_rules', label: 'Remove Inactive Rules', description: 'Delete all inactive price and product rules from Salesforce' });
    }

    // Performance issues with high rule counts
    if (['PERF-001', 'PERF-002'].includes(checkId) && issue.affected_records?.length > 0) {
      fixes.push({ fixType: 'deactivate_rule', label: 'Deactivate Rule(s)', description: `Deactivate ${issue.affected_records.length} affected rule(s) in Salesforce` });
    }

    return fixes;
  }

  async function handleApplyFix(fixType: string) {
    setShowConfirm(null);
    setApplyingFix(true);
    setFixResult(null);
    try {
      const recordIds = issue?.affected_records?.map((r) => r.id) || [];
      const res = await fetch('/api/salesforce/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, issueId, fixType, recordIds }),
      });
      const data = await res.json();
      if (res.ok) {
        setFixResult({ success: data.success, details: data.details });
        if (data.success) {
          setIssue((prev) => prev ? { ...prev, status: 'resolved' } : null);
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

  async function handleStatusChange(newStatus: string) {
    try {
      await fetch('/api/issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, status: newStatus }),
      });
      setIssue((prev) => prev ? { ...prev, status: newStatus as DBIssue['status'] } : null);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  }

  if (loading || !issue) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={issue.severity}>{issue.severity}</Badge>
            <span className="text-xs font-mono text-gray-400">{issue.check_id}</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{issue.title}</h1>
        </div>
        {/* Status dropdown */}
        <select
          value={issue.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        >
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
      </div>

      {/* What's Wrong */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">What&apos;s Wrong</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.description}</p>
        </CardContent>
      </Card>

      {/* Why It Matters */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">Why It Matters</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.impact}</p>
        </CardContent>
      </Card>

      {/* What To Change */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">What To Change</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.recommendation}</p>
        </CardContent>
      </Card>

      {/* AI Fix Suggestion */}
      <Card className="mb-4 border-purple-200">
        <CardHeader className="bg-purple-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <h3 className="text-sm font-semibold text-purple-900">AI Fix Suggestion</h3>
            </div>
            {!issue.ai_fix_suggestion && (
              <button
                onClick={handleGenerateFix}
                disabled={generatingFix}
                className="px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full hover:bg-purple-200 disabled:opacity-50"
              >
                {generatingFix ? 'Generating...' : 'Generate Fix'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {issue.ai_fix_suggestion ? (
            <p className="text-sm text-gray-700 whitespace-pre-line">{issue.ai_fix_suggestion}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">
              Click &quot;Generate Fix&quot; to get a detailed, step-by-step fix from AI.
            </p>
          )}
        </CardContent>
      </Card>

      {/* One-Click Fix */}
      {getAvailableFixes().length > 0 && (
        <Card className="mb-4 border-amber-200">
          <CardHeader className="bg-amber-50">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-900">One-Click Fix</h3>
            </div>
          </CardHeader>
          <CardContent>
            {fixResult && (
              <div className={`mb-4 p-3 rounded-lg flex items-start gap-2 ${fixResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                {fixResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-sm ${fixResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {fixResult.details}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {getAvailableFixes().map((fix) => (
                <div key={fix.fixType} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fix.label}</p>
                    <p className="text-xs text-gray-500">{fix.description}</p>
                  </div>
                  <button
                    onClick={() => setShowConfirm(fix.fixType)}
                    disabled={applyingFix || issue.status === 'resolved'}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {applyingFix ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Apply
                  </button>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-3">
              These actions modify your Salesforce org directly. Changes take effect immediately.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Confirm Fix</h3>
                <p className="text-sm text-gray-500">This will modify your Salesforce org</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-6">
              {getAvailableFixes().find((f) => f.fixType === showConfirm)?.description}. This action cannot be undone automatically. Are you sure?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApplyFix(showConfirm)}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Yes, Apply Fix
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Affected Records */}
      {issue.affected_records && issue.affected_records.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-gray-900">Affected Records</h3>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {issue.affected_records.map((record, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-400">{record.type}</span>
                  <span className="text-gray-700">{record.name}</span>
                  {org?.instance_url && (
                    <a
                      href={`${org.instance_url}/lightning/r/${record.type}/${record.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
