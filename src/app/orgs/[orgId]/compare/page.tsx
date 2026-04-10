'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, TrendingUp, TrendingDown, Minus, AlertCircle, AlertTriangle, Info, CheckCircle2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getScoreColor, getScoreBarColor, getCategoryLabel } from '@/lib/utils';
import { LoadingScreen } from '@/components/ui/loading-screen';
import type { DBScan, DBIssue } from '@/types';

interface ComparisonResult {
  scanA: { id: string; score: number; date: string; totalIssues: number };
  scanB: { id: string; score: number; date: string; totalIssues: number };
  scoreDelta: number;
  newIssues: DBIssue[];
  resolvedIssues: DBIssue[];
  unchangedIssues: DBIssue[];
  categoryChanges: Record<string, { before: number; after: number; delta: number }>;
  summary: {
    newCount: number;
    resolvedCount: number;
    unchangedCount: number;
    improved: boolean;
  };
}

export default function ComparePage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [scans, setScans] = useState<DBScan[]>([]);
  const [scanAId, setScanAId] = useState<string>('');
  const [scanBId, setScanBId] = useState<string>('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [aiInsight, setAiInsight] = useState<string>('');
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  useEffect(() => {
    async function fetchScans() {
      try {
        const res = await fetch(`/api/scans?orgId=${orgId}`);
        if (res.ok) {
          const data: DBScan[] = await res.json();
          const completed = data.filter((s) => s.status === 'completed');
          setScans(completed);
          // Auto-select last two scans
          if (completed.length >= 2) {
            setScanAId(completed[1].id);
            setScanBId(completed[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to fetch scans:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchScans();
  }, [orgId]);

  async function handleCompare() {
    if (!scanAId || !scanBId || scanAId === scanBId) return;
    setComparing(true);
    setAiInsight('');
    try {
      const res = await fetch(`/api/scans/compare?scanA=${scanAId}&scanB=${scanBId}`);
      if (res.ok) {
        const data: ComparisonResult = await res.json();
        setComparison(data);
        // Auto-generate AI insight
        fetchAiInsight(data);
      }
    } catch (error) {
      console.error('Comparison failed:', error);
    } finally {
      setComparing(false);
    }
  }

  async function fetchAiInsight(data: ComparisonResult) {
    setAiInsightLoading(true);
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'scan-diff',
          prevScore: data.scanA.score,
          newScore: data.scanB.score,
          newIssues: data.newIssues.map((i) => `[${i.check_id}] ${i.title}`),
          resolvedIssues: data.resolvedIssues.map((i) => `[${i.check_id}] ${i.title}`),
          unchangedCount: data.summary.unchangedCount,
        }),
      });
      if (res.ok) {
        const { insight } = await res.json();
        setAiInsight(insight || '');
      }
    } catch (error) {
      console.error('AI insight failed:', error);
    } finally {
      setAiInsightLoading(false);
    }
  }

  // Auto-compare when both scans are selected
  useEffect(() => {
    if (scanAId && scanBId && scanAId !== scanBId) {
      handleCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanAId, scanBId]);

  function getScanLabel(scan: DBScan, idx: number) {
    const date = scan.completed_at
      ? new Date(scan.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'N/A';
    return `Scan #${scans.length - idx} — ${date} (Score: ${scan.overall_score ?? '-'})`;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (scans.length < 2) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => router.push(`/orgs/${orgId}/history`)} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Drift Detection</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">You need at least 2 completed scans to compare. Run another scan first.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.push(`/orgs/${orgId}/history`)} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Drift Detection</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Compare two scans to see what changed</p>
        </div>
      </div>

      {/* Scan Selectors */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase">Baseline (Before)</label>
              <select
                value={scanAId}
                onChange={(e) => setScanAId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
              >
                <option value="">Select scan...</option>
                {scans.map((scan, idx) => (
                  <option key={scan.id} value={scan.id} disabled={scan.id === scanBId}>
                    {getScanLabel(scan, idx)}
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-400 mt-5 flex-shrink-0" />
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase">Latest (After)</label>
              <select
                value={scanBId}
                onChange={(e) => setScanBId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
              >
                <option value="">Select scan...</option>
                {scans.map((scan, idx) => (
                  <option key={scan.id} value={scan.id} disabled={scan.id === scanAId}>
                    {getScanLabel(scan, idx)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {comparing && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {/* Results */}
      {comparison && !comparing && (
        <div className="space-y-6">
          {/* Score Delta Hero */}
          <Card>
            <CardContent className="py-8">
              <div className="flex items-center justify-between">
                {/* Before */}
                <div className="text-center flex-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Before</p>
                  <p className={`text-4xl font-bold ${getScoreColor(comparison.scanA.score)}`}>
                    {comparison.scanA.score}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{comparison.scanA.totalIssues} issues</p>
                </div>

                {/* Delta */}
                <div className="text-center px-8">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-lg font-bold ${
                    comparison.scoreDelta > 0
                      ? 'bg-green-100 text-green-700'
                      : comparison.scoreDelta < 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {comparison.scoreDelta > 0 ? (
                      <TrendingUp className="w-5 h-5" />
                    ) : comparison.scoreDelta < 0 ? (
                      <TrendingDown className="w-5 h-5" />
                    ) : (
                      <Minus className="w-5 h-5" />
                    )}
                    {comparison.scoreDelta > 0 ? '+' : ''}{comparison.scoreDelta}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {comparison.summary.improved ? 'Health improved' : comparison.scoreDelta === 0 ? 'No change' : 'Health declined'}
                  </p>
                </div>

                {/* After */}
                <div className="text-center flex-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">After</p>
                  <p className={`text-4xl font-bold ${getScoreColor(comparison.scanB.score)}`}>
                    {comparison.scanB.score}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{comparison.scanB.totalIssues} issues</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Drift Insight */}
          {(aiInsightLoading || aiInsight) && (
            <div className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
                  <Sparkles className={`w-5 h-5 text-blue-600 dark:text-blue-400 ${aiInsightLoading ? 'animate-pulse' : ''}`} />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">AI Drift Analysis</h3>
                  {aiInsightLoading ? (
                    <div className="space-y-2">
                      <div className="h-3 bg-blue-100 dark:bg-blue-900/40 rounded w-full animate-pulse" />
                      <div className="h-3 bg-blue-100 dark:bg-blue-900/40 rounded w-3/4 animate-pulse" />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{aiInsight}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-5 text-center">
                <p className="text-3xl font-bold text-red-600">{comparison.summary.newCount}</p>
                <p className="text-sm text-gray-500 mt-1">New Issues</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5 text-center">
                <p className="text-3xl font-bold text-green-600">{comparison.summary.resolvedCount}</p>
                <p className="text-sm text-gray-500 mt-1">Resolved</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5 text-center">
                <p className="text-3xl font-bold text-gray-500">{comparison.summary.unchangedCount}</p>
                <p className="text-sm text-gray-500 mt-1">Unchanged</p>
              </CardContent>
            </Card>
          </div>

          {/* Category Changes */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Category Score Changes</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(comparison.categoryChanges)
                  .sort(([, a], [, b]) => a.delta - b.delta)
                  .map(([cat, change]) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 dark:text-gray-300 w-40 truncate">{getCategoryLabel(cat)}</span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getScoreBarColor(change.after)}`}
                            style={{ width: `${change.after}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 w-16 text-right">
                          {change.before} → {change.after}
                        </span>
                        <span className={`text-xs font-bold w-12 text-right ${
                          change.delta > 0 ? 'text-green-600' : change.delta < 0 ? 'text-red-600' : 'text-gray-400'
                        }`}>
                          {change.delta > 0 ? '+' : ''}{change.delta}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* New Issues */}
          {comparison.newIssues.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    New Issues ({comparison.newIssues.length})
                  </h3>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {comparison.newIssues.map((issue) => (
                    <DriftIssueRow key={issue.id} issue={issue} type="new" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resolved Issues */}
          {comparison.resolvedIssues.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Resolved Issues ({comparison.resolvedIssues.length})
                  </h3>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {comparison.resolvedIssues.map((issue) => (
                    <DriftIssueRow key={issue.id} issue={issue} type="resolved" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Unchanged Issues */}
          {comparison.unchangedIssues.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Minus className="w-4 h-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Unchanged Issues ({comparison.unchangedIssues.length})
                  </h3>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {comparison.unchangedIssues.map((issue) => (
                    <DriftIssueRow key={issue.id} issue={issue} type="unchanged" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function DriftIssueRow({ issue, type }: { issue: DBIssue; type: 'new' | 'resolved' | 'unchanged' }) {
  const severityIcon = {
    critical: <AlertCircle className="w-4 h-4 text-red-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    info: <Info className="w-4 h-4 text-blue-500" />,
  };

  const typeBg = {
    new: 'border-l-4 border-l-red-400',
    resolved: 'border-l-4 border-l-green-400',
    unchanged: 'border-l-4 border-l-gray-200',
  };

  return (
    <div className={`px-5 py-3.5 ${typeBg[type]}`}>
      <div className="flex items-center gap-3">
        {severityIcon[issue.severity]}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">{issue.title}</span>
            <Badge variant={issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info'}>
              {issue.check_id}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{issue.description}</p>
        </div>
        <span className="text-xs text-gray-400">{getCategoryLabel(issue.category)}</span>
      </div>
    </div>
  );
}
