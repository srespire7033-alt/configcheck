'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getScoreColor, formatTimeAgo } from '@/lib/utils';
import { LoadingScreen } from '@/components/ui/loading-screen';
import type { DBScan } from '@/types';

export default function ScanHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;
  const [scans, setScans] = useState<DBScan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchScans() {
      try {
        const res = await fetch(`/api/scans?orgId=${orgId}`);
        if (res.ok) setScans(await res.json());
      } catch (error) {
        console.error('Failed to fetch scans:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchScans();
  }, [orgId]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push(`/orgs/${orgId}`)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Scan History</h1>
        </div>
        {scans.filter((s) => s.status === 'completed').length >= 2 && (
          <button
            onClick={() => router.push(`/orgs/${orgId}/compare`)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition"
          >
            <GitCompare className="w-4 h-4" />
            Compare Scans
          </button>
        )}
      </div>

      {/* Score Trend */}
      {scans.length > 1 && (
        <Card className="mb-8">
          <CardHeader>
            <h3 className="text-sm font-semibold text-gray-900">Health Score Trend</h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {scans.slice().reverse().map((scan, idx) => {
                const score = scan.overall_score || 0;
                const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500';
                return (
                  <div key={scan.id} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-gray-700">{score}</span>
                    <div
                      className={`w-full rounded-t ${color} transition-all`}
                      style={{ height: `${Math.max(score, 5)}%` }}
                    />
                    <span className="text-[10px] text-gray-400">#{scans.length - idx}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-6 py-3">Scan</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Issues</th>
                <th className="px-6 py-3">Duration</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scans.map((scan, idx) => (
                <tr
                  key={scan.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  onClick={() => router.push(`/orgs/${orgId}`)}
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                    Scan #{scans.length - idx}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {scan.completed_at ? formatTimeAgo(scan.completed_at) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-sm font-bold ${getScoreColor(scan.overall_score || 0)}`}>
                      {scan.overall_score ?? '-'}/100
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1">
                      {scan.critical_count > 0 && <Badge variant="critical">{scan.critical_count}</Badge>}
                      {scan.warning_count > 0 && <Badge variant="warning">{scan.warning_count}</Badge>}
                      {scan.info_count > 0 && <Badge variant="info">{scan.info_count}</Badge>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {scan.duration_ms ? `${(scan.duration_ms / 1000).toFixed(1)}s` : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={scan.status === 'completed' ? 'success' : scan.status === 'failed' ? 'critical' : 'default'}>
                      {scan.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {scans.length === 0 && (
            <p className="text-center text-gray-400 py-8">No scans yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
