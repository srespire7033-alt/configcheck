'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle, BarChart3, Clock, CheckCircle2, XCircle, GitCompare, ChevronUp, ChevronDown } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { getCategoryLabel, getScoreColor, getProductTypeLabel, formatTimeAgo } from '@/lib/utils';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Badge } from '@/components/ui/badge';
import type { DBScan, DBOrganization } from '@/types';

// ─── Utility helpers ────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (!ms) return '\u2014';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type SortKey = 'date' | 'score' | 'critical' | 'warning' | 'info' | 'duration' | 'product_type' | 'status';
type SortDir = 'asc' | 'desc';

// ─── Main page component ───────────────────────────────────────────

export default function ScanHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [scans, setScans] = useState<DBScan[]>([]);
  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchData() {
      try {
        const [scansRes, orgRes] = await Promise.all([
          fetch(`/api/scans?orgId=${orgId}`),
          fetch(`/api/orgs?orgId=${orgId}`),
        ]);
        if (scansRes.ok) setScans(await scansRes.json());
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          setOrg(Array.isArray(orgData) ? orgData[0] : orgData);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [orgId]);

  // Completed scans sorted chronologically (oldest first) for charts
  const completedScans = useMemo(
    () =>
      scans
        .filter((s) => s.status === 'completed')
        .sort((a, b) => new Date(a.completed_at || a.created_at).getTime() - new Date(b.completed_at || b.created_at).getTime()),
    [scans]
  );

  const latestScan = completedScans.length > 0 ? completedScans[completedScans.length - 1] : null;
  const previousScan = completedScans.length > 1 ? completedScans[completedScans.length - 2] : null;

  // ── Score trend chart data ──
  const scoreTrendData = useMemo(
    () =>
      completedScans.map((s) => ({
        date: formatDate(s.completed_at || s.created_at),
        fullDate: formatFullDate(s.completed_at || s.created_at),
        score: s.overall_score || 0,
        issues: s.total_issues || 0,
        critical: s.critical_count,
        scanId: s.id,
      })),
    [completedScans]
  );

  // ── Issue breakdown chart data ──
  const issueBreakdownData = useMemo(
    () =>
      completedScans.map((s) => ({
        date: formatDate(s.completed_at || s.created_at),
        Critical: s.critical_count,
        Warning: s.warning_count,
        Info: s.info_count,
      })),
    [completedScans]
  );

  // ── Trend summary calculations ──
  const scoreDiff = latestScan && previousScan ? (latestScan.overall_score || 0) - (previousScan.overall_score || 0) : null;
  const issueDiff = latestScan && previousScan ? latestScan.total_issues - previousScan.total_issues : null;
  const bestScan = useMemo(() => {
    if (completedScans.length === 0) return null;
    return completedScans.reduce((best, s) => ((s.overall_score || 0) > (best.overall_score || 0) ? s : best), completedScans[0]);
  }, [completedScans]);

  // ── Category heatmap data ──
  const categoryData = useMemo(() => {
    if (!latestScan?.category_scores) return [];
    const latestScores = latestScan.category_scores;
    const prevScores = previousScan?.category_scores || {};
    return Object.entries(latestScores).map(([key, score]) => {
      const prev = prevScores[key];
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (prev !== undefined) {
        if (score > prev) trend = 'up';
        else if (score < prev) trend = 'down';
      }
      return { key, label: getCategoryLabel(key), score, prevScore: prev, trend };
    });
  }, [latestScan, previousScan]);

  // ── Sorted table data ──
  const sortedScans = useMemo(() => {
    const copy = [...scans];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = new Date(a.completed_at || a.created_at).getTime() - new Date(b.completed_at || b.created_at).getTime();
          break;
        case 'score':
          cmp = (a.overall_score || 0) - (b.overall_score || 0);
          break;
        case 'critical':
          cmp = a.critical_count - b.critical_count;
          break;
        case 'warning':
          cmp = a.warning_count - b.warning_count;
          break;
        case 'info':
          cmp = a.info_count - b.info_count;
          break;
        case 'duration':
          cmp = (a.duration_ms || 0) - (b.duration_ms || 0);
          break;
        case 'product_type':
          cmp = a.product_type.localeCompare(b.product_type);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [scans, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function toggleCompare(scanId: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(scanId)) {
        next.delete(scanId);
      } else if (next.size < 2) {
        next.add(scanId);
      }
      return next;
    });
  }

  // ── Loading / Empty states ──
  if (loading) return <LoadingScreen />;

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* ═══════ HEADER ═══════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/orgs/${orgId}`)}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Scan History &amp; Trends</h1>
            {org && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{org.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {compareIds.size === 2 && (
            <button
              onClick={() => {
                const ids = Array.from(compareIds);
                router.push(`/orgs/${orgId}/compare?a=${ids[0]}&b=${ids[1]}`);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition shadow-sm"
            >
              <GitCompare className="w-4 h-4" />
              Compare Selected
            </button>
          )}
          {completedScans.length >= 2 && (
            <button
              onClick={() => router.push(`/orgs/${orgId}/compare`)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-xl text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
            >
              <GitCompare className="w-4 h-4" />
              Compare Scans
            </button>
          )}
        </div>
      </div>

      {/* ═══════ EMPTY STATE ═══════ */}
      {scans.length === 0 && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-16 text-center">
          <BarChart3 className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No scans yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Run your first health check scan to start tracking trends.</p>
          <button
            onClick={() => router.push(`/orgs/${orgId}`)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition"
          >
            Go to Organization
          </button>
        </div>
      )}

      {scans.length > 0 && (
        <>
          {/* ═══════ SECTION 1: SCORE TREND CHART ═══════ */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Score Trend</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {completedScans.length >= 2
                    ? `${completedScans.length} scans tracked`
                    : 'Run more scans to see trends'}
                </p>
              </div>
            </div>

            {completedScans.length >= 2 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={scoreTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="historyScoreGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-20" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '13px',
                      }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg p-3 text-sm">
                            <p className="font-semibold text-gray-900 dark:text-white">{d.fullDate}</p>
                            <p className="text-blue-600 dark:text-blue-400 font-medium">Score: {d.score}/100</p>
                            <p className="text-gray-500 dark:text-gray-400">Total Issues: {d.issues}</p>
                            <p className="text-red-500">Critical: {d.critical}</p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      fill="url(#historyScoreGradient)"
                      dot={{ r: 5, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff', cursor: 'pointer' }}
                      activeDot={{ r: 7, cursor: 'pointer' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                Run more scans to visualize your score trend over time
              </div>
            )}
          </div>

          {/* ═══════ SECTION 2: TREND SUMMARY CARDS ═══════ */}
          {latestScan && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Score Trend Card */}
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Score Trend</span>
                  {scoreDiff !== null && scoreDiff !== 0 && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        scoreDiff > 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                      }`}
                    >
                      {scoreDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {scoreDiff > 0 ? '+' : ''}{scoreDiff}
                    </span>
                  )}
                  {scoreDiff === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      <Minus className="w-3 h-3" />
                      No change
                    </span>
                  )}
                </div>
                <p className={`text-3xl font-bold ${getScoreColor(latestScan.overall_score || 0)}`}>
                  {latestScan.overall_score ?? 0}
                  <span className="text-base font-normal text-gray-400">/100</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">Latest scan score</p>
              </div>

              {/* Issue Trend Card */}
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Issue Trend</span>
                  {issueDiff !== null && issueDiff !== 0 && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        issueDiff < 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                      }`}
                    >
                      {issueDiff < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                      {issueDiff < 0 ? `${Math.abs(issueDiff)} resolved` : `+${issueDiff} new`}
                    </span>
                  )}
                  {issueDiff === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      <Minus className="w-3 h-3" />
                      No change
                    </span>
                  )}
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {latestScan.total_issues}
                  <span className="text-base font-normal text-gray-400 ml-1">issues</span>
                </p>
                <div className="flex gap-2 mt-2">
                  {latestScan.critical_count > 0 && <Badge variant="critical">{latestScan.critical_count} critical</Badge>}
                  {latestScan.warning_count > 0 && <Badge variant="warning">{latestScan.warning_count} warning</Badge>}
                  {latestScan.info_count > 0 && <Badge variant="info">{latestScan.info_count} info</Badge>}
                </div>
              </div>

              {/* Best Score Card */}
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Best Score</span>
                  <Trophy className="w-5 h-5 text-yellow-500" />
                </div>
                <p className={`text-3xl font-bold ${bestScan ? getScoreColor(bestScan.overall_score || 0) : 'text-gray-400'}`}>
                  {bestScan?.overall_score ?? '\u2014'}
                  <span className="text-base font-normal text-gray-400">/100</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {bestScan?.completed_at ? `Achieved on ${formatDate(bestScan.completed_at)}` : 'No completed scans'}
                </p>
              </div>
            </div>
          )}

          {/* ═══════ SECTION 3: CATEGORY PERFORMANCE HEATMAP ═══════ */}
          {categoryData.length > 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Category Performance</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Latest scan scores by category</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {categoryData.map((cat) => {
                  const bgColor =
                    cat.score >= 80
                      ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                      : cat.score >= 60
                      ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
                      : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
                  const scoreColor =
                    cat.score >= 80
                      ? 'text-green-700 dark:text-green-400'
                      : cat.score >= 60
                      ? 'text-yellow-700 dark:text-yellow-400'
                      : 'text-red-700 dark:text-red-400';
                  return (
                    <div key={cat.key} className={`rounded-xl border p-3.5 ${bgColor}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate mr-2">
                          {cat.label}
                        </span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-lg font-bold ${scoreColor}`}>{cat.score}</span>
                          {cat.trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />}
                          {cat.trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />}
                          {cat.trend === 'stable' && <Minus className="w-3.5 h-3.5 text-gray-400" />}
                        </div>
                      </div>
                      {cat.prevScore !== undefined && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Previous: {cat.prevScore}
                          {cat.score !== cat.prevScore && (
                            <span className={cat.score > cat.prevScore ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                              ({cat.score > cat.prevScore ? '+' : ''}{cat.score - cat.prevScore})
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══════ SECTION 4: ISSUE BREAKDOWN OVER TIME ═══════ */}
          {completedScans.length >= 2 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Issue Breakdown Over Time</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Critical, warning, and info issues per scan</p>
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={issueBreakdownData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-20" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '13px',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '12px' }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Bar dataKey="Critical" stackId="issues" fill="#ef4444" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Warning" stackId="issues" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Info" stackId="issues" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ═══════ SECTION 5: SCAN HISTORY TABLE ═══════ */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-50 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                  <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">All Scans</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{scans.length} scan{scans.length !== 1 ? 's' : ''} total</p>
                </div>
              </div>
              {compareIds.size > 0 && compareIds.size < 2 && (
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Select 1 more scan to compare</p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3 w-10">
                      <span className="sr-only">Compare</span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('date')}>
                      <span className="inline-flex items-center gap-1">Date <SortIcon column="date" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('score')}>
                      <span className="inline-flex items-center gap-1">Score <SortIcon column="score" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('critical')}>
                      <span className="inline-flex items-center gap-1">Critical <SortIcon column="critical" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('warning')}>
                      <span className="inline-flex items-center gap-1">Warning <SortIcon column="warning" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('info')}>
                      <span className="inline-flex items-center gap-1">Info <SortIcon column="info" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('duration')}>
                      <span className="inline-flex items-center gap-1">Duration <SortIcon column="duration" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('product_type')}>
                      <span className="inline-flex items-center gap-1">Type <SortIcon column="product_type" /></span>
                    </th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" onClick={() => handleSort('status')}>
                      <span className="inline-flex items-center gap-1">Status <SortIcon column="status" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedScans.map((scan) => {
                    const score = scan.overall_score || 0;
                    const scoreBadgeColor =
                      score >= 80
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                        : score >= 60
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
                    const isSelected = compareIds.has(scan.id);
                    const isCompleted = scan.status === 'completed';

                    return (
                      <tr
                        key={scan.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition ${
                          isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                        }`}
                        onClick={() => router.push(`/orgs/${orgId}`)}
                      >
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          {isCompleted && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!isSelected && compareIds.size >= 2}
                              onChange={() => toggleCompare(scan.id)}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {scan.completed_at ? formatFullDate(scan.completed_at) : formatFullDate(scan.created_at)}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {scan.completed_at ? formatTimeAgo(scan.completed_at) : formatTimeAgo(scan.created_at)}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {isCompleted ? (
                            <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold ${scoreBadgeColor}`}>
                              {score}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">\u2014</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {scan.critical_count > 0 ? (
                            <Badge variant="critical">{scan.critical_count}</Badge>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {scan.warning_count > 0 ? (
                            <Badge variant="warning">{scan.warning_count}</Badge>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {scan.info_count > 0 ? (
                            <Badge variant="info">{scan.info_count}</Badge>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-sm text-gray-600 dark:text-gray-400">
                          {formatDuration(scan.duration_ms)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                            {getProductTypeLabel(scan.product_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {scan.status === 'completed' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Completed
                            </span>
                          ) : scan.status === 'failed' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                              <XCircle className="w-3.5 h-3.5" />
                              Failed
                            </span>
                          ) : (
                            <Badge variant="default">{scan.status}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
