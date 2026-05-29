'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles, Download, FileBarChart, CalendarClock, Cloud, ShieldCheck, FileSpreadsheet, ChevronDown, ChevronRight, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { getCategoryLabel, formatTimeAgo } from '@/lib/utils';
import { groupTopIssues } from '@/lib/analysis/top-issue-grouper';
import { HealthScore } from '@/components/scan/health-score';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { CategoryBreakdown } from '@/components/scan/category-breakdown';
import { GroupedIssueList } from '@/components/issues/grouped-issue-list';
import { IssueDetailModal } from '@/components/issues/issue-detail-modal';
import { SeverityModal } from '@/components/issues/severity-modal';
import { RevenueRiskCard } from '@/components/scan/revenue-risk-card';
import { RevenueLeakageCard, type RevenueLeakageData } from '@/components/scan/revenue-leakage-card';
import { ComplexityCard } from '@/components/scan/complexity-card';
import { ScheduleModal } from '@/components/schedule/schedule-modal';
import { ScheduleList } from '@/components/schedule/schedule-list';
import { ScoreTrend } from '@/components/scan/score-trend';
import { ScoreFormulaTooltip } from '@/components/scan/score-formula-tooltip';
import { TOTAL_CHECKS } from '@/lib/analysis/constants';
import type { DBScan, DBIssue, DBOrganization, DBScanSchedule, RevenueRiskSummary, ComplexityBreakdown, ProductType } from '@/types';
import { getProductTypeLabel } from '@/lib/utils';

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [scan, setScan] = useState<DBScan | null>(null);
  const [issues, setIssues] = useState<DBIssue[]>([]);
  // Tracks which Top-Issues parent groups are expanded. Family ids come
  // from the grouper (e.g. "products_missing_billing_config:product_billing_config").
  const [expandedTopGroups, setExpandedTopGroups] = useState<Set<string>>(new Set());
  const [trustScores, setTrustScores] = useState<Record<string, { total_feedback: number; trust_score: number | null }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [allScans, setAllScans] = useState<DBScan[]>([]);
  // The most recent FAILED scan if it occurred after the displayed completed
  // scan — surfaces "the scan you ran 3 minutes ago died" without forcing the
  // user to dig through History to find out why.
  const [recentFailedScan, setRecentFailedScan] = useState<DBScan | null>(null);
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
  const [availableScanTypes, setAvailableScanTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [detectingPackages, setDetectingPackages] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Auto-generate the AI Remediation Plan after a scan loads.
  // Hiding the most actionable thing (the prioritised fix plan) behind
  // an extra "Generate Plan" click was high-friction. Now it kicks off
  // automatically once we have:
  //   - a completed scan
  //   - issues to plan against
  //   - no cached plan already on the scan record
  //   - not currently generating
  // The /api/ai/insights endpoint caches the result on the scan record,
  // so subsequent loads of the same scan show it instantly without
  // calling Gemini again.
  const autoGenAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scan) return;
    if (issues.length === 0) return;
    if (remediationPlan || remediationLoading) return;
    if (autoGenAttemptedRef.current === scan.id) return;
    autoGenAttemptedRef.current = scan.id;
    handleGenerateRemediationPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, issues.length, remediationPlan, remediationLoading]);

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

      // Load cached installed packages or detect them
      if (orgData.installed_packages && orgData.installed_packages.length > 0) {
        applyAvailableScanTypes(orgData.installed_packages);
      } else if (orgData.connection_status === 'connected') {
        // No cached packages — detect in background
        detectPackages(orgData.id);
      }

      const scansRes = await fetch(`/api/scans?orgId=${orgId}`);
      if (scansRes.ok) {
        const scans = await scansRes.json();
        const completedScans = scans.filter((s: DBScan) => s.status === 'completed');
        setAllScans(completedScans);

        // Check if there's a running/pending scan — resume polling only if recent (< 10 min old)
        // Heavy orgs can take up to 3-4 min for scan + AI summary, plus network buffer
        const runningScan = scans.find((s: DBScan) => s.status === 'running' || s.status === 'pending');
        if (runningScan) {
          const scanAge = Date.now() - new Date(runningScan.created_at).getTime();
          if (scanAge < 10 * 60 * 1000) {
            pollForScan(runningScan.id);
          }
        }

        // Detect any failed scans newer than our latest completed scan, so
        // we can show a banner explaining why the user's recent attempt didn't
        // produce results. Without this, the page silently shows old data and
        // the user has no idea their last 3 scans died.
        const latestCompleted = completedScans[0] ?? null;
        const failedAfterLastCompleted = scans.find((s: DBScan) => {
          if (s.status !== 'failed') return false;
          if (!latestCompleted) return true;
          return new Date(s.created_at).getTime() > new Date(latestCompleted.created_at).getTime();
        }) || null;
        setRecentFailedScan(failedAfterLastCompleted);

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

      // Fetch aggregate trust scores so we can show "X% helpful" badges
      try {
        const trustRes = await fetch('/api/checks/trust-scores');
        if (trustRes.ok) {
          setTrustScores(await trustRes.json());
        }
      } catch (err) {
        console.error('Failed to fetch trust scores:', err);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Something went wrong loading this page. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function applyAvailableScanTypes(packages: string[]) {
    const types: Array<{ value: string; label: string }> = [];
    const hasCPQ = packages.includes('cpq');
    const hasBilling = packages.includes('billing');
    const hasARM = packages.includes('arm');

    if (hasCPQ) types.push({ value: 'cpq', label: 'CPQ' });
    if (hasCPQ && hasBilling) types.push({ value: 'cpq_billing', label: 'CPQ + Billing' });
    if (hasARM) types.push({ value: 'arm', label: 'ARM' });

    // Fallback
    if (types.length === 0) types.push({ value: 'cpq', label: 'CPQ' });

    setAvailableScanTypes(types);
    // Auto-select the best option
    if (hasCPQ && hasBilling) {
      setScanProductType('cpq_billing');
    } else if (hasARM) {
      setScanProductType('arm');
    } else {
      setScanProductType('cpq');
    }
  }

  async function detectPackages(orgIdToDetect: string) {
    setDetectingPackages(true);
    try {
      const res = await fetch('/api/orgs/detect-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgIdToDetect }),
      });
      if (res.ok) {
        const data = await res.json();
        applyAvailableScanTypes(data.packages);
      }
    } catch (err) {
      console.error('Package detection failed:', err);
      // Fallback to CPQ only
      setAvailableScanTypes([{ value: 'cpq', label: 'CPQ' }]);
    } finally {
      setDetectingPackages(false);
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

  // Poll for a running/pending scan until it completes
  function pollForScan(scanId: string) {
    // Clear any existing poll
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    setScanning(true);
    let pollCount = 0;
    const maxPolls = 65; // 65 × 3s = ~195s max

    pollIntervalRef.current = setInterval(async () => {
      pollCount++;
      try {
        const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
        const scanData = await statusRes.json();
        if (scanData.status === 'completed' || scanData.status === 'failed') {
          // AI summary now runs AFTER status='completed' is durably set —
          // if metadata.ai_summary_status is still 'pending', keep polling
          // (at the same 3s cadence) so the UI picks up the real summary
          // without requiring a manual reload. Caps at maxPolls so a stuck
          // Gemini call doesn't poll forever.
          const aiPending =
            scanData.status === 'completed' &&
            (scanData.metadata as { ai_summary_status?: string } | null)?.ai_summary_status === 'pending';
          if (aiPending && pollCount < maxPolls) {
            // Still waiting on AI — refresh visible data so the user at
            // least sees issues + score, then continue polling.
            fetchData();
            return;
          }
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setScanning(false);
          if (scanData.status === 'failed' && scanData.error_message) {
            setError(scanData.error_message);
          }
          fetchData();
        } else if (pollCount >= maxPolls) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setScanning(false);
          setError('Scan timed out. Please try again.');
          fetchData();
        }
      } catch {
        // Network error during poll — keep trying
      }
    }, 3000);
  }

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, productType: scanProductType }),
      });

      const data = await res.json();

      // Handle quota limit
      if (res.status === 429) {
        setError(data.message || 'You have reached your plan limit. Please upgrade to continue.');
        setScanning(false);
        return;
      }

      if (!data.scanId) throw new Error(data.error || 'No scanId returned');
      pollForScan(data.scanId);
    } catch (error) {
      console.error('Failed to start scan:', error);
      setScanning(false);
    }
  }

  // Use shared formatTimeAgo for consistency with org cards

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
  const acknowledgedCount = issues.filter(i => i.status === 'acknowledged').length;
  const ignoredCount = issues.filter(i => i.status === 'ignored' || i.status === 'false_positive' || i.status === 'not_relevant').length;
  // Cross-scan delta — how many issues did this scan fix vs. the previous one?
  // We approximate "fixed since last scan" by comparing total_issues totals.
  // (The DBIssue rows are scan-scoped, so an issue that disappears between
  // scans is the cleanest signal of a real fix in Salesforce.)
  const previousScan = allScans.length >= 2
    ? allScans.find(s => s.id !== scan?.id) ?? null
    : null;
  const issuesFixedSinceLastScan = previousScan && scan
    ? Math.max(0, (previousScan.total_issues || 0) - (scan.total_issues || 0))
    : 0;
  const newIssuesSinceLastScan = previousScan && scan
    ? Math.max(0, (scan.total_issues || 0) - (previousScan.total_issues || 0))
    : 0;

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
          onClick={() => { router.refresh(); router.push('/dashboard'); }}
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
        onClick={() => { router.refresh(); router.push('/dashboard'); }}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      {/* Compact org context strip
          Replaces the previous gradient banner that wasted above-the-fold
          real estate restating the product name. Users already know what
          product they're in — what they actually need is a quick read of
          which org + environment they're looking at. The strip hands the
          hero space below to the health score and primary metrics. */}
      {org && (() => {
        // Brand-color strip mirrors the dashboard org-card: instant
        // visual continuity from "click card → land on this page."
        // ARM=orange, CPQ+Billing=sky→indigo, single products=their
        // single color, none-detected=muted gray.
        const pkgs = org.installed_packages || [];
        const hasCPQ = pkgs.includes('cpq');
        const hasBilling = pkgs.includes('billing');
        const hasARM = pkgs.includes('arm');
        let stripeClass = 'bg-gray-200 dark:bg-gray-700';
        if (hasARM && !hasCPQ && !hasBilling) {
          stripeClass = 'bg-brand-orange';
        } else if (hasCPQ && hasBilling) {
          stripeClass = 'bg-gradient-to-r from-brand-sky to-brand-indigo';
        } else if (hasCPQ) {
          stripeClass = 'bg-brand-sky';
        } else if (hasBilling) {
          stripeClass = 'bg-brand-indigo';
        } else if (hasARM) {
          stripeClass = 'bg-gradient-to-r from-brand-purple via-brand-orange to-brand-indigo';
        }
        return (
          <div className="-mx-4 sm:-mx-6 mb-6">
            <div className={`h-1 ${stripeClass}`} />
            <div className="px-4 sm:px-6 pt-4 pb-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-500">
                  <Cloud className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900 dark:text-white truncate">
                    {org.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {org.is_sandbox ? 'Sandbox' : 'Production'} &middot; Connected
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                Live
              </div>
            </div>
          </div>
        );
      })()}

      {!scan ? (
        <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center py-20">
          <div className="inline-flex p-4 bg-blue-50 dark:bg-blue-900/30 rounded-2xl mb-4">
            <FileBarChart className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No scans yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {detectingPackages ? 'Detecting installed packages...' : 'Choose your scan type and run your first health check.'}
          </p>
          <div className="flex flex-col items-center gap-4">
            {detectingPackages ? (
              <div className="inline-flex items-center gap-2 text-sm text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Checking Salesforce packages...
              </div>
            ) : availableScanTypes.length > 1 ? (
              <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
                {availableScanTypes.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setScanProductType(value as ProductType)}
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
            ) : availableScanTypes.length === 1 ? (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600/10 to-cyan-600/10 dark:from-blue-500/15 dark:to-cyan-500/15 border border-blue-200/60 dark:border-blue-700/50">
                <ShieldCheck className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{availableScanTypes[0].label}</span>
                <span className="text-[10px] font-medium text-blue-500/70 dark:text-blue-400/60 uppercase tracking-wider">detected</span>
              </div>
            ) : null}
            <button
              onClick={handleScan}
              disabled={detectingPackages}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              Run First Scan
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Recent-failure banner — shown when a scan failed AFTER the latest
              completed scan. Explains why the data below is stale and how to
              recover, instead of leaving the user guessing why "Run scan" did
              nothing. */}
          {recentFailedScan && (
            <div className="mb-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-red-100 dark:bg-red-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Last scan failed {formatTimeAgo(recentFailedScan.created_at)}
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1 break-words">
                    {recentFailedScan.error_message ||
                      'No error detail recorded. The scan failed before it could complete — most often because the Salesforce session expired or the OAuth token was revoked.'}
                  </p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-2">
                    The data shown below is from the most recent successful scan. Try reconnecting the org and running a new scan.
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={handleScan}
                      disabled={scanning}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                      {scanning ? 'Retrying…' : 'Retry scan'}
                    </button>
                    <button
                      onClick={() => setRecentFailedScan(null)}
                      className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Data observed panel — only shown for ARM scans. Surfaces the
              per-object row counts OrgPrism observed during the fetch
              so the user can verify against their org reality. Distinguishes
              "0 rows returned" (object exists, no data) from "object not
              visible to the connected SF user" (license or profile issue). */}
          {scan.product_type === 'arm' && (() => {
            const meta = scan.metadata as {
              data_fetched?: Record<string, number> | null;
              query_outcomes?: Record<string, 'ok' | 'invalid_type' | 'error'> | null;
            } | null;
            const dataFetched = meta?.data_fetched || {};
            const queryOutcomes = meta?.query_outcomes || {};
            if (Object.keys(dataFetched).length === 0) return null;

            // Map ARMData camelCase keys → Salesforce sObject names so we can
            // cross-reference the per-query outcome (which is keyed by sObject).
            const dataKeyToSObject: Record<string, string> = {
              products: 'Product2',
              sellingModels: 'ProductSellingModel',
              sellingModelOptions: 'ProductSellingModelOption',
              priceAdjustmentSchedules: 'PriceAdjustmentSchedule',
              priceAdjustmentTiers: 'PriceAdjustmentTier',
              attributeBasedAdjRules: 'AttributeBasedAdjRule',
              productRelatedComponents: 'ProductRelatedComponent',
              priceBooks: 'Pricebook2',
              productCategories: 'ProductCategory',
              productCategoryProducts: 'ProductCategoryProduct',
              pricingProcedures: 'ExpressionSet',
              decisionTables: 'DecisionTable',
              contextDefinitions: 'ContextDefinition',
              rateCards: 'RateCard',
              rateCardEntries: 'RateCardEntry',
              attributeDefinitions: 'AttributeDefinition',
              attributeCategories: 'AttributeCategory',
              attributePicklistValues: 'AttributePicklistValue',
              assets: 'Asset',
              assetStatePeriods: 'AssetStatePeriod',
              assetRelationships: 'AssetRelationship',
              contracts: 'Contract',
              contractItemPrices: 'ContractItemPrice',
              unitOfMeasureClasses: 'UnitOfMeasureClass',
              usageResources: 'UsageResource',
              productUsageGrants: 'ProductUsageGrant',
              fulfillmentStepDefinitions: 'FulfillmentStepDefinition',
              fulfillmentStepDefinitionGroups: 'FulfillmentStepDefinitionGroup',
              productFulfillmentScenarios: 'ProductFulfillmentScenario',
              fulfillmentTaskAssignmentRules: 'FulfillmentTaskAssignmentRule',
              costBooks: 'CostBook',
              costBookEntries: 'CostBookEntry',
              // v5
              pricebookEntries: 'PricebookEntry',
              taxTreatments: 'TaxTreatment',
              taxEngines: 'TaxEngine',
              taxPolicies: 'TaxPolicy',
              taxTreatmentItems: 'TaxTreatmentItem',
              billingPolicies: 'BillingPolicy',
              billingTreatments: 'BillingTreatment',
              billingArrangements: 'BillingArrangement',
              billingArrangementLines: 'BillingArrangementLine',
              billingMilestonePlans: 'BillingMilestonePlan',
              billingMilestonePlanItems: 'BillingMilestonePlanItem',
              paymentRetryRuleSets: 'PaymentRetryRuleSet',
              generalLedgerAccounts: 'GeneralLedgerAccount',
              generalLedgerAcctAsgntRules: 'GeneralLedgerAcctAsgntRule',
              accountingPeriods: 'AccountingPeriod',
              legalEntityAccountingPeriods: 'LegalEntyAccountingPeriod',
              documentClauseSets: 'DocumentClauseSet',
              documentClauses: 'DocumentClause',
              productQualifications: 'ProductQualification',
              productRampSegments: 'ProductRampSegment',
              fulfillmentStepDependencyDefs: 'FulfillmentStepDependencyDef',
            };

            const entries = Object.entries(dataFetched).sort((a, b) => Number(b[1]) - Number(a[1]));
            const populated = entries.filter(([, v]) => Number(v) > 0);
            const empty = entries.filter(([, v]) => Number(v) === 0);
            // Among empties, distinguish "INVALID_TYPE" (object not visible to the
            // connected user) from "object visible but 0 rows".
            const notVisible = empty.filter(
              ([k]) => queryOutcomes[dataKeyToSObject[k] || k] === 'invalid_type'
            );
            const errored = empty.filter(
              ([k]) => queryOutcomes[dataKeyToSObject[k] || k] === 'error'
            );
            const trulyEmpty = empty.filter(([k]) => {
              const outcome = queryOutcomes[dataKeyToSObject[k] || k];
              return !outcome || outcome === 'ok';
            });
            const labelize = (k: string) =>
              k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

            // Severity heuristic for the "not visible" pill: a handful of
            // INVALID_TYPE objects on an otherwise healthy fetch is just
            // "this org didn't enable that optional Revenue Cloud feature"
            // — not a permission alert. Promote to amber only when a
            // significant chunk of the schema is missing (>25% of total),
            // which is the actual permissions-issue signal. The schema is
            // 53 objects; below ~13 missing it's almost always optional
            // Revenue Cloud features the org just hasn't licensed.
            const visibilityIsConcerning =
              notVisible.length / entries.length > 0.25;

            // When everything's healthy — no errored queries, visibility
            // not concerning — the panel is just informational clutter.
            // Only render when there's something the user needs to see.
            if (errored.length === 0 && !visibilityIsConcerning) return null;

            return (
              <details className="mb-6 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-2xl group" open={visibilityIsConcerning || errored.length > 0}>
                <summary className="cursor-pointer px-4 sm:px-5 py-3 flex items-center gap-3 text-sm font-medium text-blue-800 dark:text-blue-300 flex-wrap">
                  <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90 flex-shrink-0" />
                  ARM data observed: <span className="font-bold">{populated.length}</span> of {entries.length} object types had data
                  {notVisible.length > 0 && visibilityIsConcerning && (
                    <span className="ml-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                      {notVisible.length} not visible to connected user
                    </span>
                  )}
                  {notVisible.length > 0 && !visibilityIsConcerning && (
                    <span className="ml-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {notVisible.length} feature{notVisible.length !== 1 ? 's' : ''} not enabled
                    </span>
                  )}
                  {errored.length > 0 && (
                    <span className="ml-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300">
                      {errored.length} errored
                    </span>
                  )}
                </summary>
                <div className="px-4 sm:px-5 pb-4 pt-1">
                  {/* Populated objects */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                    {populated.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between py-0.5 border-b border-blue-100/60 dark:border-blue-900/30">
                        <span className="text-gray-700 dark:text-gray-300">{labelize(k)}</span>
                        <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Not-visible (INVALID_TYPE) — split presentation by severity:
                      - many missing → likely a permissions issue, alert in amber
                      - few missing  → optional Revenue Cloud features not enabled,
                        muted gray "informational" treatment */}
                  {notVisible.length > 0 && visibilityIsConcerning && (
                    <div className="mt-3 pt-3 border-t border-blue-100 dark:border-blue-900/40 bg-amber-50/60 dark:bg-amber-950/20 rounded-lg px-3 py-2 -mx-1">
                      <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1">
                        Not visible to connected SF user ({notVisible.length}) — Salesforce returned INVALID_TYPE
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed mb-1">
                        {notVisible.map(([k]) => labelize(k)).join(' · ')}
                      </div>
                      <div className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                        These objects exist in Salesforce but the connected user&apos;s profile can&apos;t see them. Reconnect with a System Admin profile, or grant the connected user read on these objects.
                      </div>
                    </div>
                  )}
                  {notVisible.length > 0 && !visibilityIsConcerning && (
                    <div className="mt-3 pt-2 border-t border-blue-100/60 dark:border-blue-900/30">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                        Optional Revenue Cloud feature{notVisible.length !== 1 ? 's' : ''} not enabled in this org ({notVisible.length}):
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        {notVisible.map(([k]) => labelize(k)).join(' · ')}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        Checks for these features are skipped automatically. Enable them in Setup → Feature Settings if you want them scanned.
                      </div>
                    </div>
                  )}

                  {/* Errored — auth, network, permission denied mid-query.
                      Surface the actual Salesforce errorCode + message so the
                      user (and we) can diagnose without digging into raw
                      metadata. */}
                  {errored.length > 0 && (() => {
                    const failures = (scan.metadata as { query_failures?: Array<{ object: string; errorCode: string; errorMsg: string }> | null } | null)?.query_failures || [];
                    const failureBySObject = new Map<string, { errorCode: string; errorMsg: string }>();
                    for (const f of failures) failureBySObject.set(f.object, { errorCode: f.errorCode, errorMsg: f.errorMsg });
                    return (
                      <div className="mt-2 pt-2 bg-red-50/60 dark:bg-red-950/20 rounded-lg px-3 py-2 -mx-1">
                        <div className="text-[11px] font-semibold text-red-800 dark:text-red-300 mb-1">
                          Query errored ({errored.length})
                        </div>
                        <div className="space-y-1.5">
                          {errored.map(([k]) => {
                            const sObject = dataKeyToSObject[k] || k;
                            const fail = failureBySObject.get(sObject);
                            return (
                              <div key={k} className="text-[11px] text-red-700 dark:text-red-400 leading-relaxed">
                                <span className="font-medium">{labelize(k)}</span>
                                {fail && (
                                  <>
                                    {' '}<span className="font-mono text-[10px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40">{fail.errorCode}</span>
                                    {fail.errorMsg && fail.errorMsg !== 'no message' && (
                                      <div className="text-[10px] text-red-600/80 dark:text-red-400/80 mt-0.5 ml-1 break-words font-mono">{fail.errorMsg}</div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Truly empty — object visible, just no rows */}
                  {trulyEmpty.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-blue-100/60 dark:border-blue-900/30">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                        Empty (object visible, no rows): {trulyEmpty.length}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        {trulyEmpty.map(([k]) => labelize(k)).join(' · ')}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            );
          })()}

          {/* Silent-query-failures warning — surfaces ARM SOQL queries that
              failed and returned empty so we don't trust an artificially-high
              score. Without this, missing data looked exactly like a clean
              org. */}
          {(() => {
            const meta = scan.metadata as {
              query_failures?: Array<{ object: string; errorCode: string; errorMsg: string }> | null;
              data_fetched?: Record<string, number> | null;
              product_type?: string;
            } | null;
            const failures = meta?.query_failures;
            const dataFetched = meta?.data_fetched || {};
            const isARM = scan.product_type === 'arm' || meta?.product_type === 'arm';

            // Detect "sparse data" condition for ARM scans — when most object
            // families are empty, the high score isn't really informative.
            // 33 ARM object families are queried; flag when fewer than 3 have data.
            let sparseARM: { observed: number; total: number; populatedObjects: string[] } | null = null;
            if (isARM && Object.keys(dataFetched).length > 0) {
              const total = Object.keys(dataFetched).length;
              const populated = Object.entries(dataFetched).filter(([, v]) => Number(v) > 0);
              if (populated.length <= 3 && populated.length < total) {
                sparseARM = {
                  observed: populated.length,
                  total,
                  populatedObjects: populated.map(([k]) => k),
                };
              }
            }

            if ((!failures || failures.length === 0) && !sparseARM) return null;

            const failedObjects = failures
              ? Array.from(new Set(failures.map((f) => f.object))).slice(0, 6)
              : [];

            return (
              <div className="mb-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      {sparseARM
                        ? `Score may not be meaningful — ARM data observed in only ${sparseARM.observed} of ${sparseARM.total} object types`
                        : `Score may be incomplete — ${failures!.length} ${failures!.length === 1 ? 'query' : 'queries'} failed silently`}
                    </p>
                    {sparseARM && (
                      <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                        Most ARM objects had zero rows in this org, so most checks had nothing to evaluate against. The high score reflects that absence, not a clean configuration. Populated:{' '}
                        <span className="font-mono text-xs">
                          {sparseARM.populatedObjects.length > 0 ? sparseARM.populatedObjects.join(', ') : 'none'}
                        </span>
                      </p>
                    )}
                    {failures && failures.length > 0 && (
                      <p className={`text-sm text-amber-700 dark:text-amber-400 ${sparseARM ? 'mt-2' : 'mt-1'}`}>
                        We couldn&apos;t read these objects from Salesforce, so checks that depend on them found nothing to flag. Affected: <span className="font-mono text-xs">{failedObjects.join(', ')}{failedObjects.length < new Set(failures.map((f) => f.object)).size ? '…' : ''}</span>
                      </p>
                    )}
                    <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-2">
                      {sparseARM
                        ? 'Likely causes: this org only uses a subset of Revenue Cloud features, the OAuth scope is missing for the unread objects, or the connected user doesn’t have read permission. Reconnecting with full read scope ensures we see everything that’s actually configured.'
                        : 'Most common cause: an OAuth scope is missing for these objects, or the user that connected the org doesn’t have read permission on them. Reconnecting the org with full read scope usually resolves it.'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== HEALTH SCORE CARD — matches ideation exactly ===== */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 lg:p-8 mb-8">
            <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-12">
              {/* Score Ring */}
              <div className="flex-shrink-0">
                <HealthScore score={scan.overall_score || 0} size="lg" />
              </div>

              {/* Score Breakdown */}
              <div className="flex-1 w-full">
                <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white mb-4 text-center lg:text-left flex items-center justify-center lg:justify-start gap-1">
                  Your {scan.product_type ? getProductTypeLabel(scan.product_type) : 'CPQ'} Health Score
                  <ScoreFormulaTooltip />
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6 text-center lg:text-left text-sm">
                  Last scan: {formatTimeAgo(scan.completed_at || scan.created_at)} &bull; {issues.length} issues found
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

                {/* Resolution Progress — true progress bar (gray base, fills
                    green-from-left as issues are resolved). Earlier we used a
                    4-segment state bar (resolved/ack/ignored/open) but at
                    0/14 the bar rendered fully amber, which read as "everything
                    is broken" instead of "nothing fixed yet." The text counts
                    above already convey ack/ignored, so the bar is now a
                    single-purpose progress indicator. */}
                {issues.length > 0 && (() => {
                  const total = issues.length;
                  const pct = total === 0 ? 0 : (resolvedCount / total) * 100;
                  return (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="text-gray-500 dark:text-gray-400">Resolution Progress</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {resolvedCount}/{total} fixed
                          {acknowledgedCount > 0 && (
                            <span className="text-brand-indigo dark:text-brand-sky"> • {acknowledgedCount} ack</span>
                          )}
                          {ignoredCount > 0 && (
                            <span className="text-gray-400"> • {ignoredCount} ignored</span>
                          )}
                        </span>
                      </div>
                      {/* True progress bar: empty gray base, grows green from
                          left as users mark issues fixed. */}
                      <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all duration-500 rounded-full"
                          style={{ width: `${pct}%` }}
                          title={`${resolvedCount} of ${total} resolved`}
                        />
                      </div>
                      {/* Cross-scan delta — only when we have a previous scan to compare to */}
                      {previousScan && (issuesFixedSinceLastScan > 0 || newIssuesSinceLastScan > 0) && (
                        <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
                          {issuesFixedSinceLastScan > 0 && (
                            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              {issuesFixedSinceLastScan} fixed since last scan
                            </span>
                          )}
                          {newIssuesSinceLastScan > 0 && (
                            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              {newIssuesSinceLastScan} new since last scan
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 sm:gap-3 flex-shrink-0 w-full lg:w-auto">
                {/* Scan type pills */}
                <div className="flex items-center gap-2 self-center lg:self-auto">
                  {detectingPackages ? (
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-gray-400" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Detecting packages...</span>
                    </div>
                  ) : availableScanTypes.length > 1 ? (
                    <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
                      {availableScanTypes.map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => setScanProductType(value as ProductType)}
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
                  ) : availableScanTypes.length === 1 ? (
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600/10 to-cyan-600/10 dark:from-blue-500/15 dark:to-cyan-500/15 border border-blue-200/60 dark:border-blue-700/50">
                      <ShieldCheck className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{availableScanTypes[0].label}</span>
                      <span className="text-[10px] font-medium text-blue-500/70 dark:text-blue-400/60 uppercase tracking-wider">scan</span>
                    </div>
                  ) : null}
                  {/* Re-detect packages button */}
                  {!detectingPackages && (
                    <button
                      onClick={() => org && detectPackages(org.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      title="Re-detect installed packages"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Action buttons */}
                <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3">
                  {/* Unified Download / Export menu — consolidates the PDF report
                      and the Excel/CSV issue & documentation exports in one
                      prominent place (was previously split: PDF here, Excel
                      buried below the trend chart). */}
                  <div className="relative">
                    <button
                      onClick={() => setShowExportMenu(!showExportMenu)}
                      onBlur={() => setTimeout(() => setShowExportMenu(false), 150)}
                      className="w-full px-3 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2 text-sm sm:text-base"
                    >
                      <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                      Report
                      <ChevronDown className={`w-4 h-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showExportMenu && (
                      <div className="absolute top-full right-0 lg:right-auto lg:left-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-30">
                        <a
                          href={`/api/reports?scanId=${scan.id}`}
                          className="flex items-start gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          <FileBarChart className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <div className="text-left">
                            <div className="font-medium">PDF Report</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">Branded executive summary — share with clients</div>
                          </div>
                        </a>
                        <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                        <a
                          href={`/api/exports?scanId=${scan.id}&format=xlsx&type=issues`}
                          className="flex items-start gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <div className="text-left">
                            <div className="font-medium">Issues — Excel</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">Filterable workbook for triage</div>
                          </div>
                        </a>
                        <a
                          href={`/api/exports?scanId=${scan.id}&format=csv&type=issues`}
                          className="flex items-start gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <div className="text-left">
                            <div className="font-medium">Issues — CSV</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">Plain CSV for Jira / ticket import</div>
                          </div>
                        </a>
                        <a
                          href={`/api/exports?scanId=${scan.id}&format=xlsx&type=documentation`}
                          className="flex items-start gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                          <div className="text-left">
                            <div className="font-medium">Config Documentation</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">Full inventory of probed objects</div>
                          </div>
                        </a>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="px-3 sm:px-6 py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm shadow-blue-600/30 hover:shadow-blue-600/40 text-sm sm:text-base"
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

          {/* ===== TOP ISSUES TO ADDRESS =====
              Sort criticals before warnings, drop info-severity, then run
              the grouper to fold sibling issues like "products missing X"
              under one parent (so the same configuration gap doesn't
              dominate the top-N list with four duplicates). */}
          {issues.length > 0 && (() => {
            const seen = new Set<string>();
            const sorted = [...issues]
              .sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 };
                const aOrder = order[a.severity as keyof typeof order] ?? 3;
                const bOrder = order[b.severity as keyof typeof order] ?? 3;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return (b.affected_records?.length || 0) - (a.affected_records?.length || 0);
              })
              .filter((i) => {
                if (i.severity === 'info') return false;
                if (seen.has(i.title)) return false;
                seen.add(i.title);
                return true;
              });

            const grouped = groupTopIssues(sorted).slice(0, 5);
            if (grouped.length === 0) return null;

            return (
              <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-50 dark:bg-red-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Top Issues to Address</h3>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Highest priority issues affecting your configuration</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {grouped.map((item, idx) => {
                    if (item.kind === 'single') {
                      const issue = item.issue;
                      return (
                        <button
                          key={issue.id}
                          onClick={() => setSelectedIssue(issue)}
                          className="w-full text-left flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition border border-gray-100 dark:border-gray-800"
                        >
                          <span className="text-sm font-bold text-gray-400 dark:text-gray-500 mt-0.5 w-5 text-center flex-shrink-0">{idx + 1}</span>
                          <div
                            className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                              issue.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  issue.severity === 'critical'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400'
                                }`}
                              >
                                {issue.severity}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">{getCategoryLabel(issue.category)}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{issue.title}</p>
                            {issue.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{issue.description}</p>
                            )}
                          </div>
                          {issue.affected_records?.length ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1">
                              {issue.affected_records.length} affected
                            </span>
                          ) : null}
                        </button>
                      );
                    }

                    // Parent group — collapsible, contains 2+ siblings
                    const parent = item;
                    const isExpanded = expandedTopGroups.has(parent.id);
                    return (
                      <div
                        key={parent.id}
                        className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden"
                      >
                        <button
                          onClick={() => {
                            setExpandedTopGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(parent.id)) next.delete(parent.id);
                              else next.add(parent.id);
                              return next;
                            });
                          }}
                          className="w-full text-left flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                        >
                          <span className="text-sm font-bold text-gray-400 dark:text-gray-500 mt-0.5 w-5 text-center flex-shrink-0">{idx + 1}</span>
                          <div
                            className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                              parent.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  parent.severity === 'critical'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400'
                                }`}
                              >
                                {parent.severity}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">{getCategoryLabel(parent.category)}</span>
                              <span className="inline-flex items-center text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                {parent.children.length} related
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{parent.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{parent.description}</p>
                          </div>
                          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1">
                            {parent.uniqueAffectedRecords} unique affected
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="bg-gray-50/60 dark:bg-gray-900/30 divide-y divide-gray-100 dark:divide-gray-800/60">
                            {parent.children.map((child) => (
                              <button
                                key={child.id}
                                onClick={() => setSelectedIssue(child)}
                                className="w-full text-left flex items-start gap-3 pl-12 pr-3 py-2.5 hover:bg-white/60 dark:hover:bg-gray-800/40 transition"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-700 dark:text-gray-300">{child.title}</p>
                                  {child.description && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{child.description}</p>
                                  )}
                                </div>
                                {child.affected_records?.length ? (
                                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1">
                                    {child.affected_records.length}
                                  </span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
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

          {/* ===== CATEGORY ISSUES MODAL ===== */}
          {selectedCategory && (() => {
            const catIssues = issues.filter(i => i.category === selectedCategory);
            const catCritical = catIssues.filter(i => i.severity === 'critical');
            const catWarning = catIssues.filter(i => i.severity === 'warning');
            const catInfo = catIssues.filter(i => i.severity === 'info');

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedCategory(null)} />

                {/* Modal */}
                <div className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 flex-shrink-0">
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

                  {/* Scrollable content */}
                  <div className="overflow-y-auto flex-1">
                    {catIssues.length === 0 ? (
                      <div className="px-6 py-10 text-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">No issues found in this category.</p>
                      </div>
                    ) : (
                      <div>
                        {/* Critical */}
                        {catCritical.length > 0 && (
                          <div>
                            <div className="px-6 py-2.5 bg-red-50/50 dark:bg-red-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 sticky top-0 z-10">
                              <AlertCircle className="w-4 h-4 text-red-500" />
                              <span className="text-sm font-semibold text-red-700 dark:text-red-400">Critical ({catCritical.length})</span>
                            </div>
                            <GroupedIssueList
                              issues={catCritical}
                              onIssueClick={(issue) => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                              trustScores={trustScores}
                            />
                          </div>
                        )}

                        {/* Warning */}
                        {catWarning.length > 0 && (
                          <div>
                            <div className="px-6 py-2.5 bg-amber-50/50 dark:bg-amber-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 sticky top-0 z-10">
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                              <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">Warnings ({catWarning.length})</span>
                            </div>
                            <GroupedIssueList
                              issues={catWarning}
                              onIssueClick={(issue) => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                              trustScores={trustScores}
                            />
                          </div>
                        )}

                        {/* Best Practice */}
                        {catInfo.length > 0 && (
                          <div>
                            <div className="px-6 py-2.5 bg-blue-50/50 dark:bg-blue-950/20 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 sticky top-0 z-10">
                              <Info className="w-4 h-4 text-blue-500" />
                              <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Best Practices ({catInfo.length})</span>
                            </div>
                            <GroupedIssueList
                              issues={catInfo}
                              onIssueClick={(issue) => setSelectedIssue(issue)}
                              onStatusChange={handleIssueStatusChange}
                              trustScores={trustScores}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== SCORE TREND CHART =====
              Filtered to scans of the SAME product_type as the displayed scan.
              Mixing CPQ + ARM + Billing scans on one chart was misleading
              because each engine has a different score distribution — an
              ARM 99 next to a CPQ 91 isn't comparable. */}
          {(() => {
            const sameTypeScans = allScans.filter((s) => s.product_type === scan.product_type);
            if (sameTypeScans.length < 2) return null;
            return (
              <ScoreTrend
                scans={sameTypeScans}
                onViewHistory={() => router.push(`/orgs/${orgId}/history`)}
              />
            );
          })()}

          {/* ===== REVENUE LEAKAGE (NEW — TechTorch ask) =====
              Headline $ number derived from org's actual SF data + per-
              check formulas with recoverability + LTV multipliers. Sits
              ABOVE the older revenue-risk card because this is the
              consultant-deliverable headline. */}
          {(() => {
            const meta = scan.metadata as Record<string, unknown> | null;
            const leakage = meta?.revenue_leakage as RevenueLeakageData | undefined;
            if (!leakage) return null;
            return (
              <div className="mb-8">
                <RevenueLeakageCard leakage={leakage} />
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

          {/* Old severity-based issue lists removed — issues now shown by category above.
              Export controls moved into the unified "Download" menu in the header
              actions block (consolidates PDF + Excel + CSV + Documentation). */}

          {/* ===== AI RECOMMENDATIONS =====
              Skim-first layout: one-sentence headline derived from issue
              counts, then a "top affected categories" bullet list with
              jump links into the category modal, then the full AI prose
              behind a "Show full analysis" toggle so it doesn't dominate
              the page on first view. */}
          {scan.summary && (() => {
            const critCount = issues.filter((i) => i.severity === 'critical').length;
            const warnCount = issues.filter((i) => i.severity === 'warning').length;
            const infoCount = issues.filter((i) => i.severity === 'info').length;

            // Find the 3 categories with the most critical findings; fall
            // back to most-warning when an org has zero criticals so the
            // bullet list is still useful.
            const byCat = new Map<string, { critical: number; warning: number; total: number }>();
            for (const i of issues) {
              const e = byCat.get(i.category) ?? { critical: 0, warning: 0, total: 0 };
              if (i.severity === 'critical') e.critical += 1;
              else if (i.severity === 'warning') e.warning += 1;
              e.total += 1;
              byCat.set(i.category, e);
            }
            // Use Array.from rather than spread on a MapIterator — the
            // tsconfig target doesn't enable downlevelIteration, so spreading
            // an iterator typechecks-fails even though it works at runtime.
            const topCats = Array.from(byCat.entries())
              .sort(([, a], [, b]) => {
                if (a.critical !== b.critical) return b.critical - a.critical;
                if (a.warning !== b.warning) return b.warning - a.warning;
                return b.total - a.total;
              })
              .slice(0, 3)
              .filter(([, c]) => c.total > 0);

            // Headline — derived deterministically from counts so we don't
            // depend on the AI summary having a single sentence we can
            // pull. Phrasing follows the doc's "Your org has X critical
            // issues centred on Y..." pattern.
            const headline =
              critCount === 0 && warnCount === 0 && infoCount === 0
                ? `Your org is clean across all ${TOTAL_CHECKS} health checks.`
                : critCount > 0
                ? `Your org has ${critCount} critical issue${critCount !== 1 ? 's' : ''}${
                    topCats.length > 0
                      ? ' centred on ' + topCats.slice(0, 2).map(([c]) => getCategoryLabel(c)).join(' and ')
                      : ''
                  }.`
                : warnCount > 0
                ? `Your org is critical-clean but has ${warnCount} warning${warnCount !== 1 ? 's' : ''} worth reviewing.`
                : `Your org has ${infoCount} best-practice nudge${infoCount !== 1 ? 's' : ''}.`;

            return (
              <div className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 p-6 mb-8">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-white dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
                    <Sparkles className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">AI-Powered Analysis</h3>
                    <p className="text-gray-700 dark:text-gray-200 font-medium mb-3">{headline}</p>

                    {topCats.length > 0 && (() => {
                      // Bullets show only the top 3 categories. When the org
                      // has criticals/warnings spread across more categories
                      // the bullet sums don't match the header counts, which
                      // confused users (e.g. header says 15 critical but
                      // bullets list 5+4+2=11). Add a residual line so the
                      // numbers reconcile.
                      const shownCritical = topCats.reduce((s, [, c]) => s + c.critical, 0);
                      const shownWarning = topCats.reduce((s, [, c]) => s + c.warning, 0);
                      const otherCritical = Math.max(0, critCount - shownCritical);
                      const otherWarning = Math.max(0, warnCount - shownWarning);
                      const otherCategoryCount = byCat.size - topCats.length;
                      const hasResidual =
                        (otherCritical > 0 || otherWarning > 0) && otherCategoryCount > 0;
                      return (
                        <>
                          <ul className="space-y-1.5 mb-2">
                            {topCats.map(([cat, counts]) => {
                              const parts: string[] = [];
                              if (counts.critical > 0) parts.push(`${counts.critical} critical`);
                              if (counts.warning > 0) parts.push(`${counts.warning} warning${counts.warning !== 1 ? 's' : ''}`);
                              return (
                                <li key={cat} className="flex items-start gap-2 text-sm">
                                  <span className="text-blue-500 mt-1">&bull;</span>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedCategory(cat)}
                                    className="text-left text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition"
                                  >
                                    <span className="font-semibold">{getCategoryLabel(cat)}</span>
                                    <span className="text-gray-500 dark:text-gray-400">
                                      {' '}— {parts.join(', ')}
                                      {' '}
                                      <span className="text-blue-600 dark:text-blue-400">→ View</span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                          {hasResidual && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 ml-4">
                              + {[
                                otherCritical > 0 ? `${otherCritical} critical` : null,
                                otherWarning > 0 ? `${otherWarning} warning${otherWarning !== 1 ? 's' : ''}` : null,
                              ]
                                .filter(Boolean)
                                .join(', ')}{' '}
                              across {otherCategoryCount} other categor{otherCategoryCount !== 1 ? 'ies' : 'y'} — see Top Issues above
                            </p>
                          )}
                        </>
                      );
                    })()}

                    <details className="group">
                      <summary className="cursor-pointer list-none inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        <ChevronRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
                        Show full analysis
                      </summary>
                      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">{scan.summary}</p>
                    </details>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== REMEDIATION PLAN ===== */}
          {issues.length > 0 && (
            <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-purple/10 dark:bg-brand-purple/15 rounded-xl flex items-center justify-center ring-1 ring-brand-purple/20">
                    <Sparkles className="w-5 h-5 text-brand-purple" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Remediation Plan</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Prioritized 3-phase fix plan generated by AI</p>
                  </div>
                </div>
                {/* Manual Regenerate button — shown only after a plan
                    exists, since the first plan is now generated
                    automatically when the scan loads (see auto-gen
                    useEffect at the top of the component). */}
                {remediationPlan && (
                  <button
                    onClick={handleGenerateRemediationPlan}
                    disabled={remediationLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-purple dark:text-purple-300 bg-brand-purple/10 dark:bg-brand-purple/15 hover:bg-brand-purple/15 dark:hover:bg-brand-purple/25 rounded-lg transition disabled:opacity-50 ring-1 ring-brand-purple/20"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${remediationLoading ? 'animate-spin' : ''}`} />
                    {remediationLoading ? 'Regenerating…' : 'Regenerate'}
                  </button>
                )}
              </div>
              {remediationLoading && !remediationPlan && (
                <div>
                  <p className="text-xs text-brand-purple dark:text-purple-300 mb-3 inline-flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    Generating prioritised plan&hellip; usually takes 5-10 seconds
                  </p>
                  <div className="space-y-3">
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full animate-pulse" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/6 animate-pulse" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full animate-pulse" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4 animate-pulse" />
                  </div>
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
                    className="px-4 py-2 bg-brand-purple text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition flex-shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}
              {/* No "click to generate" empty state any more — first
                  plan is auto-generated and subsequent ones are cached
                  on the scan record. If we land here it means the scan
                  has no issues at all (caller already gates on
                  issues.length > 0 above the parent block). */}
            </div>
          )}

          {/* ===== SCHEDULED SCANS =====
              onRunNow lets the user kick off a scan when a scheduled run is
              overdue (cron lag, server clock drift, etc.). Reuses the same
              handleScan() that the top-of-page Run Scan button calls. */}
          <ScheduleList
            schedules={schedules}
            onToggle={handleToggleSchedule}
            onDelete={handleDeleteSchedule}
            onCreateClick={() => setShowScheduleModal(true)}
            onRunNow={async () => {
              await handleScan();
            }}
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
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Your Revenue Cloud configuration looks great.</p>
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
