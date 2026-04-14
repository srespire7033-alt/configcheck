'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles, Download, FileBarChart, CalendarClock, ShieldCheck, FileSpreadsheet, ChevronDown, AlertTriangle, AlertCircle, Info, TrendingUp, History, X } from 'lucide-react';
import { getCategoryLabel } from '@/lib/utils';
import { HealthScore } from '@/components/scan/health-score';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { CategoryBreakdown } from '@/components/scan/category-breakdown';
import { IssueCard } from '@/components/issues/issue-card';
import { IssueDetailModal } from '@/components/issues/issue-detail-modal';
import { SeverityModal } from '@/components/issues/severity-modal';
import { RevenueRiskCard } from '@/components/scan/revenue-risk-card';
import { ComplexityCard } from '@/components/scan/complexity-card';
import { ScheduleModal } from '@/components/schedule/schedule-modal';
import { ScheduleList } from '@/components/schedule/schedule-list';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { DBScan, DBIssue, DBOrganization, DBScanSchedule, RevenueRiskSummary, ComplexityBreakdown, ProductType } from '@/types';
import { getProductTypeLabel } from '@/lib/utils';

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [scan, setScan] = useState<DBScan | null>(null);
  const [issues, setIssues] = useState<DBIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [allScans, setAllScans] = useState<DBScan[]>([]);
  const [schedules, setSchedules] = useState<DBScanSchedule[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [remediationPlan, setRemediationPlan] = useState<string>('');
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [remediationError, setRemediationError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<DBIssue | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'critical' | 'warning' | 'info' | null>(null);
  const [scanProductType, setScanProductType] = useState<ProductType>('cpq');

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function fetchData() {
    try {
      setError(null);

      const orgRes = await fetch(`/api/orgs?orgId=${orgId}`);
      if (!orgRes.ok) {
        if (orgRes.status === 401) {
          setError('Your session has expired. Please log in again.');
          return;
        }
        setError('Organization not found. It may have been disconnected.');
        return;
      }
      const orgData = await orgRes.json();
      setOrg(orgData);

      // Check if Salesforce connection is expired
      if (orgData.connection_status === 'expired') {
        setError('Your Salesforce connection has expired. Please reconnect your org from the Dashboard.');
      }

      const scansRes = await fetch(`/api/scans?orgId=${orgId}`);
      if (scansRes.ok) {
        const scans = await scansRes.json();
        const completedScans = scans.filter((s: DBScan) => s.status === 'completed');
        setAllScans(completedScans);
        // Use the latest COMPLETED scan, not running/failed ones
        const latestScan = completedScans.length > 0 ? completedScans[0] : (scans.length > 0 ? scans[0] : null);
        if (latestScan) {
          setScan(latestScan);

          // Load cached remediation plan if available
          if (latestScan.ai_remediation_plan) {
            setRemediationPlan(latestScan.ai_remediation_plan);
          }

          const issuesRes = await fetch(`/api/issues?scanId=${latestScan.id}`);
          if (issuesRes.ok) {
            const issuesData = await issuesRes.json();
            setIssues(issuesData);
          }
        }
      }
      // Fetch schedules
      const schedulesRes = await fetch(`/api/schedules?orgId=${orgId}`);
      if (schedulesRes.ok) {
        const schedulesData = await schedulesRes.json();
        setSchedules(schedulesData);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Something went wrong loading this page. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchSchedules() {
    try {
      const res = await fetch(`/api/schedules?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data);
      }
    } catch (error) {
      console.error('Failed to fetch schedules:', error);
    }
  }

  async function handleToggleSchedule(scheduleId: string, enabled: boolean) {
    try {
      await fetch('/api/schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, enabled }),
      });
      fetchSchedules();
    } catch (error) {
      console.error('Failed to toggle schedule:', error);
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    try {
      await fetch(`/api/schedules?scheduleId=${scheduleId}`, { method: 'DELETE' });
      fetchSchedules();
    } catch (error) {
      console.error('Failed to delete schedule:', error);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, productType: scanProductType }),
      });
      const { scanId } = await res.json();

      let pollCount = 0;
      const maxPolls = 65; // 65 × 3s = ~195s max (matches 180s server timeout + buffer)
      const interval = setInterval(async () => {
        pollCount++;
        const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
        const scanData = await statusRes.json();
        if (scanData.status === 'completed' || scanData.status === 'failed') {
          clearInterval(interval);
          setScanning(false);
          if (scanData.status === 'failed' && scanData.error_message) {
            setError(scanData.error_message);
          }
          fetchData();
        } else if (pollCount >= maxPolls) {
          clearInterval(interval);
          setScanning(false);
          setError('Scan timed out. Please try again.');
          fetchData();
        }
      }, 3000);
    } catch (error) {
      console.error('Failed to start scan:', error);
      setScanning(false);
    }
  }

  // Time since last scan
  const getTimeSince = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  async function handleIssueStatusChange(issueId: string, status: string) {
    try {
      await fetch('/api/issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, status }),
      });
      setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: status as DBIssue['status'] } : i));
    } catch (err) {
      console.error('Failed to update issue status:', err);
    }
  }

  async function handleGenerateRemediationPlan() {
    if (!scan || issues.length === 0) return;
    setRemediationLoading(true);
    setRemediationError(null);
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'remediation-plan',
          scanId: scan.id,
          issues: issues.map((i) => ({
            check_id: i.check_id,
            severity: i.severity,
            title: i.title,
            affected_records: i.affected_records,
            effort_hours: i.effort_hours,
          })),
          overallScore: scan.overall_score || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRemediationError(data.error || 'Failed to generate plan.');
        return;
      }
      setRemediationPlan(data.plan || '');
    } catch (error) {
      console.error('Remediation plan failed:', error);
      setRemediationError('Network error. Please try again.');
    } finally {
      setRemediationLoading(false);
    }
  }

  const resolvedCount = issues.filter(i => i.status === 'resolved').length;

  if (loading) {
    return <LoadingScreen />;
  }

  if (error && !org) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex p-4 bg-red-50 rounded-2xl mb-4">
          <AlertTriangle className="h-10 w-10 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Unable to load organization</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-6">{error}</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Error Banner */}
      {error && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800">{error}</p>
        </div>
      )}

      {/* Back Navigation */}
      <button
        onClick={() => router.push('/dashboard')}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      {/* Gradient Org Header */}
      {org && (
        <div
          className="rounded-2xl text-white px-4 sm:px-6 py-4 mb-6"
          style={{ background: 'linear-gradient(135deg, #0b8aff 0%, #00b4b4 100%)' }}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: '#5B9BF3' }}
              >
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">ConfigCheck</h1>
                <p className="text-sm text-white/80">AI-Powered CPQ Configuration Auditor</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-white/80">Connected Org</p>
                <p className="font-medium">{org.name} ({org.is_sandbox ? 'Sandbox' : 'Production'})</p>
              </div>
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {!scan ? (
        <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center py-20">
          <div className="inline-flex p-4 bg-blue-50 dark:bg-blue-900/30 rounded-2xl mb-4">
            <FileBarChart className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No scans yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Choose your scan type and run your first health check.</p>
          <div className="flex flex-col items-center gap-4">
            <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
              {([
                { value: 'cpq' as ProductType, label: 'CPQ' },
                { value: 'cpq_billing' as ProductType, label: 'CPQ + Billing' },
                { value: 'arm' as ProductType, label: 'ARM' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setScanProductType(value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    scanProductType === value
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleScan}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Run First Scan
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ===== HEALTH SCORE CARD — matches ideation exactly ===== */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 lg:p-8 mb-8">
            <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-12">
              {/* Score Ring */}
              <div className="flex-shrink-0">
                <HealthScore score={scan.overall_score || 0} size="lg" />
              </div>

              {/* Score Breakdown */}
              <div className="flex-1 w-full">
                <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white mb-4 text-center lg:text-left">
                  Your {scan.product_type ? getProductTypeLabel(scan.product_type) : 'CPQ'} Health Score
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6 text-center lg:text-left text-sm">
                  Last scan: {getTimeSince(scan.created_at)} &bull; {issues.length} issues found
                  {org && ` • ${org.name}`}
                  {org?.is_sandbox === false && ' (Production)'}
                  {org?.is_sandbox === true && ' (Sandbox)'}
                </p>

                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  {/* Critical */}
                  <button
                    onClick={() => setSeverityFilter(severityFilter === 'critical' ? null : 'critical')}
                    className={`text-left bg-red-50 dark:bg-red-950/40 rounded-xl p-2.5 sm:p-4 border transition-all hover:shadow-md cursor-pointer ${
                      severityFilter === 'critical' ? 'border-red-400 dark:border-red-500 ring-2 ring-red-200 dark:ring-red-800' : 'border-red-100 dark:border-red-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 rounded-full" />
                      <span className="text-xl sm:text-2xl font-bold text-red-700 dark:text-red-400">{scan.critical_count}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-red-600 dark:text-red-400/80">Critical</p>
                  </button>

                  {/* Warnings */}
                  <button
                    onClick={() => setSeverityFilter(severityFilter === 'warning' ? null : 'warning')}
                    className={`text-left bg-amber-50 dark:bg-amber-950/40 rounded-xl p-2.5 sm:p-4 border transition-all hover:shadow-md cursor-pointer ${
                      severityFilter === 'warning' ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-200 dark:ring-amber-800' : 'border-amber-100 dark:border-amber-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-amber-500 rounded-full" />
                      <span className="text-xl sm:text-2xl font-bold text-amber-700 dark:text-amber-400">{scan.warning_count}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400/80">Warnings</p>
                  </button>

                  {/* Info */}
                  <button
                    onClick={() => setSeverityFilter(severityFilter === 'info' ? null : 'info')}
                    className={`text-left bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5 sm:p-4 border transition-all hover:shadow-md cursor-pointer ${
                      severityFilter === 'info' ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-gray-400 rounded-full" />
                      <span className="text-xl sm:text-2xl font-bold text-gray-700 dark:text-gray-300">{scan.info_count}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Best Practices</p>
                  </button>
                </div>

                {/* Resolution Progress */}
                {issues.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-gray-500 dark:text-gray-400">Resolution Progress</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{resolvedCount}/{issues.length} fixed</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${(resolvedCount / issues.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 sm:gap-3 flex-shrink-0 w-full lg:w-auto">
                {/* Scan type pills */}
                <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700 self-center lg:self-auto">
                  {([
                    { value: 'cpq' as ProductType, label: 'CPQ' },
                    { value: 'cpq_billing' as ProductType, label: 'CPQ + Billing' },
                    { value: 'arm' as ProductType, label: 'ARM' },
                  ]).map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setScanProductType(value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                        scanProductType === value
                          ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Action buttons */}
                <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3">
                  <a
                    href={`/api/reports?scanId=${scan.id}`}
                    className="px-3 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2 text-sm sm:text-base"
                  >
                    <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden xs:inline">Download</span> Report
                  </a>
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="px-3 sm:px-6 py-2.5 sm:py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm sm:text-base"
                  >
                    <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${scanning ? 'animate-spin' : ''}`} />
                    {scanning ? 'Scanning...' : 'New Scan'}
                  </button>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="px-3 sm:px-6 py-2.5 sm:py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-2 text-sm sm:text-base"
                  >
                    <CalendarClock className="w-4 h-4 sm:w-5 sm:h-5" />
                    Schedule
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ===== TOP ISSUES TO ADDRESS ===== */}
          {issues.length > 0 && (() => {
            // Deduplicate by title, prioritize critical first, then warning
            const seen = new Set<string>();
            const topIssues = [...issues]
              .sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 };
                const aOrder = order[a.severity as keyof typeof order] ?? 3;
                const bOrder = order[b.severity as keyof typeof order] ?? 3;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return (b.affected_records?.length || 0) - (a.affected_records?.length || 0);
              })
              .filter(i => {
                if (i.severity === 'info') return false; // Only critical + warning
                if (seen.has(i.title)) return false;
                seen.add(i.title);
                return true;
              })
              .slice(0, 5);

            if (topIssues.length === 0) return null;

            return (
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-50 dark:bg-red-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Top Issues to Address</h3>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Highest priority issues affecting your CPQ config</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {topIssues.map((issue, idx) => (
                    <button
                      key={issue.id}
                      onClick={() => setSelectedIssue(issue)}
                      className="w-full text-left flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition border border-gray-100 dark:border-gray-800"
                    >
                      <span className="text-sm font-bold text-gray-400 dark:text-gray-500 mt-0.5 w-5 text-center flex-shrink-0">{idx + 1}</span>
                      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${issue.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            issue.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400'
                          }`}>{issue.severity}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">{getCategoryLabel(issue.category)}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{issue.title}</p>
                        {issue.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{issue.description}</p>
                        )}
                      </div>
                      {issue.affected_records?.length ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1">{issue.affected_records.length} affected</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ===== CATEGORY SCORES — 5-column grid ===== */}
          <div className="mb-6">
            {scan.category_scores && (
              <CategoryBreakdown
                scores={scan.category_scores}
                issues={issues}
                layout="horizontal"
                selectedCategory={selectedCategory}
                onCategoryClick={(cat) => setSelectedCategory(selectedCategory === cat ? null : cat)}
              />
            )}
          </div>

          {/* ===== CATEGORY ISSUES PANEL ===== */}
          {selectedCategory && (() => {
            const catIssues = issues.filter(i => i.category === selectedCategory);
            const catCritical = catIssues.filter(i => i.severity === 'critical');
            const catWarning = catIssues.filter(i => i.severity === 'warning');
            const catInfo = catIssues.filter(i => i.severity === 'info');

            return (
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-blue-200 dark:border-blue-800/50 mb-8 overflow-hidden">
                {/* Panel header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-blue-50/50 dark:bg-blue-900/10">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {getCategoryLabel(selectedCategory)} Issues
                    <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({catIssues.length} total)
                    </span>
                  </h3>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {catIssues.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">No issues found in this category.</p>
                  </div>
                ) : (
                  <div>
                    {/* Critical */}
                    {catCritical.length > 0 && (
                      <div>
                        <div className="px-6 py-2.5 bg-red-50/50 dark:bg-red-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-semibold text-red-700 dark:text-red-400">Critical ({catCritical.length})</span>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {catCritical.map((issue) => (
                            <IssueCard
                              key={issue.id}
                              issue={issue}
                              onClick={() => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warning */}
                    {catWarning.length > 0 && (
                      <div>
                        <div className="px-6 py-2.5 bg-amber-50/50 dark:bg-amber-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">Warnings ({catWarning.length})</span>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {catWarning.map((issue) => (
                            <IssueCard
                              key={issue.id}
                              issue={issue}
                              onClick={() => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Best Practice */}
                    {catInfo.length > 0 && (
                      <div>
                        <div className="px-6 py-2.5 bg-blue-50/50 dark:bg-blue-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                          <Info className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Best Practices ({catInfo.length})</span>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {catInfo.map((issue) => (
                            <IssueCard
                              key={issue.id}
                              issue={issue}
                              onClick={() => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ===== SCORE TREND CHART ===== */}
          {allScans.length >= 2 && (() => {
            const trendData = allScans
              .slice()
              .reverse()
              .map((s, idx) => ({
                name: new Date(s.completed_at || s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                score: s.overall_score || 0,
                issues: s.total_issues || 0,
                scan: `Scan #${idx + 1}`,
              }));
            const first = trendData[0]?.score || 0;
            const last = trendData[trendData.length - 1]?.score || 0;
            const diff = last - first;
            return (
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Score Trend</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {diff > 0 ? (
                          <span className="text-green-600 font-medium">+{diff} points improvement</span>
                        ) : diff < 0 ? (
                          <span className="text-red-600 font-medium">{diff} points decline</span>
                        ) : (
                          <span>No change</span>
                        )}
                        {' '}over {allScans.length} scans
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/orgs/${orgId}/history`)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 dark:text-gray-400 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-xl transition"
                  >
                    <History className="w-4 h-4" />
                    View History
                  </button>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(value: any, name: any) => [
                          name === 'score' ? `${value}/100` : value,
                          name === 'score' ? 'Health Score' : 'Issues',
                        ]}
                      />
                      <Area type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2.5} fill="url(#scoreGradient)" dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* ===== REVENUE RISK + COMPLEXITY ===== */}
          {(() => {
            const meta = scan.metadata as Record<string, unknown> | null;
            if (!meta) return null;
            const rev = meta.revenue_summary as RevenueRiskSummary | undefined;
            const comp = meta.complexity as ComplexityBreakdown | undefined;
            if (!rev && !comp) return null;
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {rev && <RevenueRiskCard summary={rev} />}
                {comp && <ComplexityCard complexity={comp} />}
              </div>
            );
          })()}

          {/* ===== EXPORT BUTTON ===== */}
          <div className="relative inline-block mb-8 flex justify-end">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              onBlur={() => setTimeout(() => setShowExportMenu(false), 150)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Issues
              <ChevronDown className={`w-4 h-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
                <a
                  href={`/api/exports?scanId=${scan.id}&format=xlsx&type=issues`}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  Download Excel
                </a>
                <a
                  href={`/api/exports?scanId=${scan.id}&format=csv&type=issues`}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                >
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  Download CSV
                </a>
              </div>
            )}
          </div>

          {/* Old severity-based issue lists removed — issues now shown by category above */}

          {/* ===== AI RECOMMENDATIONS ===== */}
          {scan.summary && (
            <div className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 p-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
                  <Sparkles className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">AI-Powered Analysis</h3>
                  <p className="text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">{scan.summary}</p>
                </div>
              </div>
            </div>
          )}

          {/* ===== REMEDIATION PLAN ===== */}
          {issues.length > 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Remediation Plan</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Prioritized 3-phase fix plan generated by AI</p>
                  </div>
                </div>
                {!remediationPlan && (
                  <button
                    onClick={handleGenerateRemediationPlan}
                    disabled={remediationLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    <Sparkles className={`w-4 h-4 ${remediationLoading ? 'animate-spin' : ''}`} />
                    {remediationLoading ? 'Generating...' : 'Generate Plan'}
                  </button>
                )}
              </div>
              {remediationLoading && !remediationPlan && (
                <div className="space-y-3">
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full animate-pulse" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/6 animate-pulse" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full animate-pulse" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4 animate-pulse" />
                </div>
              )}
              {remediationPlan && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-sans bg-gray-50 dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700">{remediationPlan}</pre>
                </div>
              )}
              {remediationError && (
                <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-700 dark:text-amber-400">{remediationError}</p>
                  </div>
                  <button
                    onClick={handleGenerateRemediationPlan}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition flex-shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!remediationPlan && !remediationLoading && !remediationError && (
                <p className="text-sm text-gray-400 dark:text-gray-500">Click &quot;Generate Plan&quot; to get an AI-powered prioritized remediation plan for all your issues.</p>
              )}
            </div>
          )}

          {/* ===== SCHEDULED SCANS ===== */}
          <ScheduleList
            schedules={schedules}
            onToggle={handleToggleSchedule}
            onDelete={handleDeleteSchedule}
            onCreateClick={() => setShowScheduleModal(true)}
          />

          {/* No issues state */}
          {issues.length === 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center py-16">
              <div className="inline-flex p-4 bg-green-50 dark:bg-green-900/30 rounded-2xl mb-3">
                <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-600 dark:text-gray-300 font-medium">No issues found!</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Your CPQ configuration looks great.</p>
            </div>
          )}
        </>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <ScheduleModal
          orgId={orgId}
          onClose={() => setShowScheduleModal(false)}
          onCreated={fetchSchedules}
        />
      )}

      {/* Severity Issues Modal */}
      {severityFilter && (
        <SeverityModal
          severity={severityFilter}
          issues={issues.filter(i => i.severity === severityFilter)}
          onClose={() => setSeverityFilter(null)}
          onIssueClick={(issue) => {
            setSeverityFilter(null);
            setSelectedIssue(issue);
          }}
        />
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <IssueDetailModal
          issue={selectedIssue}
          instanceUrl={org?.instance_url || undefined}
          onClose={() => setSelectedIssue(null)}
          onStatusChange={handleIssueStatusChange}
        />
      )}
    </div>
  );
}
