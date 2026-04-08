'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Lightbulb, Download } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryBreakdown } from '@/components/scan/category-breakdown';
import { IssueCard } from '@/components/issues/issue-card';
import { getScoreColor } from '@/lib/utils';
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
      // Fetch org details
      const orgRes = await fetch(`/api/orgs?orgId=${orgId}`);
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrg(orgData);
      }

      // Fetch latest scan
      const scansRes = await fetch(`/api/scans?orgId=${orgId}`);
      if (scansRes.ok) {
        const scans = await scansRes.json();
        if (scans.length > 0) {
          const latestScan = scans[0];
          setScan(latestScan);

          // Fetch issues for latest scan
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{org?.name || 'Organization'}</h1>
            <p className="text-sm text-gray-500">
              {org?.is_sandbox ? 'Sandbox' : 'Production'}
              {org?.cpq_package_version ? ` | CPQ v${org.cpq_package_version}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {scan && (
            <a
              href={`/api/reports?scanId=${scan.id}`}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              PDF Report
            </a>
          )}
          <button
            onClick={() => router.push(`/orgs/${orgId}/history`)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            History
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {!scan ? (
        <Card>
          <CardContent className="text-center py-16">
            <p className="text-gray-500 mb-4">No scans yet. Run your first scan to see results.</p>
            <button
              onClick={handleScan}
              className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Run First Scan
            </button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Score + Categories Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Health Score */}
            <Card>
              <CardContent className="flex flex-col items-center py-8">
                <p className="text-sm font-medium text-gray-500 mb-2">Health Score</p>
                <span className={`text-6xl font-bold ${getScoreColor(scan.overall_score || 0)}`}>
                  {scan.overall_score}
                </span>
                <span className="text-gray-400 text-sm">/100</span>
                <div className="flex gap-3 mt-4">
                  <Badge variant="critical">{scan.critical_count} Critical</Badge>
                  <Badge variant="warning">{scan.warning_count} Warnings</Badge>
                  <Badge variant="info">{scan.info_count} Info</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Category Breakdown */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h3 className="text-sm font-semibold text-gray-900">Category Breakdown</h3>
              </CardHeader>
              <CardContent>
                {scan.category_scores && (
                  <CategoryBreakdown scores={scan.category_scores} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Summary */}
          {scan.summary && (
            <Card className="mb-8 bg-blue-50 border-blue-200">
              <CardContent>
                <div className="flex gap-3">
                  <Lightbulb className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-blue-900 mb-2">AI Analysis</h3>
                    <p className="text-sm text-blue-800 whitespace-pre-line">{scan.summary}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Issues */}
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Issues ({filteredIssues.length})
            </h3>
            <div className="flex gap-2">
              {['all', 'critical', 'warning', 'info'].map((sev) => (
                <button
                  key={sev}
                  onClick={() => setFilterSeverity(sev)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border ${
                    filterSeverity === sev
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
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
              <p className="text-center text-gray-400 py-8">
                No issues found for this filter.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
