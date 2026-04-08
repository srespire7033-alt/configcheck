'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Sparkles, Download, Clock, FileBarChart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HealthScore } from '@/components/scan/health-score';
import { CategoryBreakdown } from '@/components/scan/category-breakdown';
import { IssueCard } from '@/components/issues/issue-card';
import type { DBScan, DBIssue, DBOrganization } from '@/types';

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [scan, setScan] = useState<DBScan | null>(null);
  const [issues, setIssues] = useState<DBIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

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
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
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

  const filteredIssues = issues.filter(
    (i) => filterSeverity === 'all' || i.severity === filterSeverity
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-gray-200 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64 bg-white rounded-2xl border border-gray-200" />
          <div className="h-64 bg-white rounded-2xl border border-gray-200 lg:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{org?.name || 'Organization'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                org?.is_sandbox ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  org?.is_sandbox ? 'bg-amber-500' : 'bg-emerald-500'
                }`} />
                {org?.is_sandbox ? 'Sandbox' : 'Production'}
              </span>
              {org?.cpq_package_version && (
                <span className="text-xs text-gray-400">| CPQ v{org.cpq_package_version}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {scan && (
            <a
              href={`/api/reports?scanId=${scan.id}`}
              className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 flex items-center gap-2 transition-all shadow-sm"
            >
              <Download className="h-4 w-4" />
              PDF Report
            </a>
          )}
          <button
            onClick={() => router.push(`/orgs/${orgId}/history`)}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 flex items-center gap-2 transition-all shadow-sm"
          >
            <Clock className="h-4 w-4" />
            History
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-all shadow-sm shadow-blue-600/20"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {!scan ? (
        <div className="bg-white rounded-2xl border border-gray-200 text-center py-20">
          <div className="inline-flex p-4 bg-blue-50 rounded-2xl mb-4">
            <FileBarChart className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No scans yet</h3>
          <p className="text-sm text-gray-500 mb-6">Run your first scan to see the health report.</p>
          <button
            onClick={handleScan}
            className="px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm shadow-blue-600/20"
          >
            Run First Scan
          </button>
        </div>
      ) : (
        <>
          {/* Score + Categories Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Health Score */}
            <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center">
              <p className="text-sm font-medium text-gray-500 mb-4">Health Score</p>
              <HealthScore score={scan.overall_score || 0} size="lg" />
              <div className="flex gap-2 mt-6 flex-wrap justify-center">
                <Badge variant="critical">{scan.critical_count} Critical</Badge>
                <Badge variant="warning">{scan.warning_count} Warnings</Badge>
                <Badge variant="info">{scan.info_count} Info</Badge>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 mb-5">Category Breakdown</h3>
              {scan.category_scores && (
                <CategoryBreakdown scores={scan.category_scores} />
              )}
            </div>
          </div>

          {/* AI Summary */}
          {scan.summary && (
            <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/60 p-6">
              <div className="flex gap-3">
                <div className="p-2 bg-blue-100 rounded-xl flex-shrink-0">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">AI Analysis</h3>
                  <p className="text-sm text-blue-800/80 leading-relaxed whitespace-pre-line">{scan.summary}</p>
                </div>
              </div>
            </div>
          )}

          {/* Issues */}
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Issues ({filteredIssues.length})
            </h3>
            <div className="flex gap-1.5">
              {['all', 'critical', 'warning', 'info'].map((sev) => (
                <button
                  key={sev}
                  onClick={() => setFilterSeverity(sev)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    filterSeverity === sev
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {sev.charAt(0).toUpperCase() + sev.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onClick={() => router.push(`/orgs/${orgId}/issues/${issue.id}`)}
              />
            ))}
            {filteredIssues.length === 0 && (
              <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
                <p className="text-gray-400">No issues found for this filter.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
