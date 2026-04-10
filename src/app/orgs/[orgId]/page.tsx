'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles, Download, FileBarChart, CalendarClock, ShieldCheck, FileSpreadsheet, FileText } from 'lucide-react';
import { HealthScore } from '@/components/scan/health-score';
import { CategoryBreakdown } from '@/components/scan/category-breakdown';
import { IssueCard } from '@/components/issues/issue-card';
import { RevenueRiskCard } from '@/components/scan/revenue-risk-card';
import { ComplexityCard } from '@/components/scan/complexity-card';
import { ScheduleModal } from '@/components/schedule/schedule-modal';
import { ScheduleList } from '@/components/schedule/schedule-list';
import type { DBScan, DBIssue, DBOrganization, DBScanSchedule, RevenueRiskSummary, ComplexityBreakdown } from '@/types';

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [scan, setScan] = useState<DBScan | null>(null);
  const [issues, setIssues] = useState<DBIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [schedules, setSchedules] = useState<DBScanSchedule[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function fetchData() {
    try {
      const orgRes = await fetch(`/api/orgs?orgId=${orgId}`);
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrg(orgData);
      }

      const scansRes = await fetch(`/api/scans?orgId=${orgId}`);
      if (scansRes.ok) {
        const scans = await scansRes.json();
        if (scans.length > 0) {
          const latestScan = scans[0];
          setScan(latestScan);

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
    } catch (error) {
      console.error('Failed to fetch data:', error);
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
        body: JSON.stringify({ organizationId: orgId }),
      });
      const { scanId } = await res.json();

      const interval = setInterval(async () => {
        const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
        const scanData = await statusRes.json();
        if (scanData.status === 'completed' || scanData.status === 'failed') {
          clearInterval(interval);
          setScanning(false);
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

  // Group issues by severity
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const warningIssues = issues.filter(i => i.severity === 'warning');
  const infoIssues = issues.filter(i => i.severity === 'info');

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-gray-200 rounded-xl" />
        <div className="h-64 bg-white rounded-2xl border border-gray-100 shadow-sm" />
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-gray-100 shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Back Navigation */}
      <button
        onClick={() => router.push('/dashboard')}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      {/* Gradient Org Header */}
      {org && (
        <div
          className="rounded-2xl text-white px-6 py-4 mb-6"
          style={{ background: 'linear-gradient(135deg, #0b8aff 0%, #00b4b4 100%)' }}
        >
          <div className="flex items-center justify-between">
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 text-center py-20">
          <div className="inline-flex p-4 bg-blue-50 rounded-2xl mb-4">
            <FileBarChart className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No scans yet</h3>
          <p className="text-sm text-gray-500 mb-6">Run your first scan to see the health report.</p>
          <button
            onClick={handleScan}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition"
          >
            Run First Scan
          </button>
        </div>
      ) : (
        <>
          {/* ===== HEALTH SCORE CARD — matches ideation exactly ===== */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
            <div className="flex items-center gap-12">
              {/* Score Ring */}
              <div className="flex-shrink-0">
                <HealthScore score={scan.overall_score || 0} size="lg" />
              </div>

              {/* Score Breakdown */}
              <div className="flex-1">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Your CPQ Health Score</h2>
                <p className="text-gray-600 mb-6">
                  Last scan: {getTimeSince(scan.created_at)} &bull; {issues.length} issues found
                  {org && ` • ${org.name}`}
                  {org?.is_sandbox === false && ' (Production)'}
                  {org?.is_sandbox === true && ' (Sandbox)'}
                </p>

                <div className="grid grid-cols-3 gap-4">
                  {/* Critical */}
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 bg-red-500 rounded-full" />
                      <span className="text-2xl font-bold text-red-700">{scan.critical_count}</span>
                    </div>
                    <p className="text-sm text-red-600">Critical Issues</p>
                  </div>

                  {/* Warnings */}
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 bg-amber-500 rounded-full" />
                      <span className="text-2xl font-bold text-amber-700">{scan.warning_count}</span>
                    </div>
                    <p className="text-sm text-amber-600">Warnings</p>
                  </div>

                  {/* Info */}
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 bg-gray-400 rounded-full" />
                      <span className="text-2xl font-bold text-gray-700">{scan.info_count}</span>
                    </div>
                    <p className="text-sm text-gray-600">Best Practices</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 flex-shrink-0">
                <a
                  href={`/api/reports?scanId=${scan.id}`}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download Report
                </a>
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-5 h-5 ${scanning ? 'animate-spin' : ''}`} />
                  {scanning ? 'Scanning...' : 'Run New Scan'}
                </button>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition flex items-center gap-2"
                >
                  <CalendarClock className="w-5 h-5" />
                  Schedule Scan
                </button>
              </div>
            </div>
          </div>

          {/* ===== CATEGORY SCORES — 5-column grid ===== */}
          <div className="mb-6">
            {scan.category_scores && (
              <CategoryBreakdown
                scores={scan.category_scores}
                issues={issues}
                layout="horizontal"
              />
            )}
          </div>

          {/* ===== REVENUE RISK + COMPLEXITY ===== */}
          {(() => {
            const meta = scan.metadata as Record<string, unknown> | null;
            if (!meta) return null;
            const rev = meta.revenue_summary as RevenueRiskSummary | undefined;
            const comp = meta.complexity as ComplexityBreakdown | undefined;
            if (!rev && !comp) return null;
            return (
              <div className="grid grid-cols-2 gap-6 mb-8">
                {rev && <RevenueRiskCard summary={rev} />}
                {comp && <ComplexityCard complexity={comp} />}
              </div>
            );
          })()}

          {/* ===== EXPORT BUTTONS ===== */}
          <div className="flex items-center gap-3 mb-8">
            <a
              href={`/api/exports?scanId=${scan.id}&format=xlsx&type=issues`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Issues (Excel)
            </a>
            <a
              href={`/api/exports?scanId=${scan.id}&format=csv&type=issues`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
            >
              <FileText className="w-4 h-4" />
              Export CSV
            </a>
            <a
              href={`/api/exports?scanId=${scan.id}&format=xlsx&type=documentation`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 transition"
            >
              <FileSpreadsheet className="w-4 h-4" />
              CPQ Documentation
            </a>
          </div>

          {/* ===== CRITICAL ISSUES ===== */}
          {criticalIssues.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full" />
                  Critical Issues Requiring Immediate Attention
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {criticalIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onClick={() => router.push(`/orgs/${orgId}/issues/${issue.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ===== WARNING ISSUES ===== */}
          {warningIssues.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-3 h-3 bg-amber-500 rounded-full" />
                  Warnings to Review
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {warningIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onClick={() => router.push(`/orgs/${orgId}/issues/${issue.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ===== INFO ISSUES ===== */}
          {infoIssues.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-500 rounded-full" />
                  Best Practice Suggestions
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {infoIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onClick={() => router.push(`/orgs/${orgId}/issues/${issue.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ===== AI RECOMMENDATIONS ===== */}
          {scan.summary && (
            <div className="bg-gradient-to-r from-blue-50 to-teal-50 rounded-2xl border border-blue-100 p-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
                  <Sparkles className="w-7 h-7 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">AI-Powered Analysis</h3>
                  <p className="text-gray-600 leading-relaxed whitespace-pre-line">{scan.summary}</p>
                </div>
              </div>
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
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 text-center py-16">
              <div className="inline-flex p-4 bg-green-50 rounded-2xl mb-3">
                <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-600 font-medium">No issues found!</p>
              <p className="text-sm text-gray-400 mt-1">Your CPQ configuration looks great.</p>
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
    </div>
  );
}
