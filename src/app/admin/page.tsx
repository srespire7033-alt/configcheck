'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Building2,
  Scan,
  AlertTriangle,
  Sparkles,
  FileText,
  Activity,
  ShieldCheck,
  UserPlus,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface AdminStats {
  summary: {
    total_users: number;
    new_users_this_month: number;
    total_orgs: number;
    total_scans: number;
    total_issues: number;
    total_ai_calls: number;
    total_pdf_reports: number;
  };
  plan_distribution: Record<string, number>;
  users: Array<{
    id: string;
    email: string;
    full_name: string | null;
    company_name: string | null;
    plan: string;
    orgs_count: number;
    scans_count: number;
    created_at: string;
  }>;
  recent_activity: Array<{
    id: string;
    user_email: string;
    event_type: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

const EVENT_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  scan: { label: 'Ran a scan', icon: '🔍', color: 'text-blue-600 dark:text-blue-400' },
  pdf_report: { label: 'Generated PDF report', icon: '📄', color: 'text-amber-600 dark:text-amber-400' },
  ai_remediation: { label: 'AI Remediation Plan', icon: '🤖', color: 'text-purple-600 dark:text-purple-400' },
  ai_scan_diff: { label: 'AI Scan Comparison', icon: '🔬', color: 'text-green-600 dark:text-green-400' },
  ai_fix_suggestion: { label: 'AI Fix Suggestion', icon: '💡', color: 'text-indigo-600 dark:text-indigo-400' },
};

const PLAN_STYLES: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  solo: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  practice: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  partner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((res) => {
        if (res.status === 403) {
          router.push('/dashboard');
          return null;
        }
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => data && setStats(data))
      .catch(() => setError('Failed to load admin stats'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <LoadingScreen />;
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>;
  if (!stats) return null;

  const { summary, plan_distribution, users, recent_activity } = stats;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-600 rounded-lg">
          <ShieldCheck className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Platform-wide metrics and user management</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        {[
          { label: 'Total Users', value: summary.total_users, icon: Users, bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400' },
          { label: 'New This Month', value: summary.new_users_this_month, icon: UserPlus, bg: 'bg-cyan-50 dark:bg-cyan-900/20', text: 'text-cyan-600 dark:text-cyan-400' },
          { label: 'Orgs', value: summary.total_orgs, icon: Building2, bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-600 dark:text-indigo-400' },
          { label: 'Scans', value: summary.total_scans, icon: Scan, bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-600 dark:text-green-400' },
          { label: 'Issues Found', value: summary.total_issues, icon: AlertTriangle, bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400' },
          { label: 'AI Calls', value: summary.total_ai_calls, icon: Sparkles, bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-600 dark:text-purple-400' },
          { label: 'PDF Reports', value: summary.total_pdf_reports, icon: FileText, bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400' },
        ].map(({ label, value, icon: Icon, bg, text }) => (
          <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
            <Icon className={`h-5 w-5 mx-auto mb-1.5 ${text}`} />
            <div className={`text-2xl font-bold ${text}`}>{value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            Plan Distribution
          </h2>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {['free', 'solo', 'practice', 'partner'].map((plan) => {
              const count = plan_distribution[plan] || 0;
              const pct = summary.total_users > 0 ? Math.round((count / summary.total_users) * 100) : 0;
              return (
                <div key={plan} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${PLAN_STYLES[plan]}`}>
                      {plan}
                    </span>
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{count}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{pct}% of users</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            All Users ({users.length})
          </h2>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Email</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Name</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Company</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Plan</th>
                  <th className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Orgs</th>
                  <th className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3 pr-4">Scans</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase py-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="py-3 pr-4 text-gray-900 dark:text-white font-medium">{u.email}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{u.full_name || '—'}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{u.company_name || '—'}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${PLAN_STYLES[u.plan] || PLAN_STYLES.free}`}>
                        {u.plan}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-center text-gray-600 dark:text-gray-300">{u.orgs_count}</td>
                    <td className="py-3 pr-4 text-center text-gray-600 dark:text-gray-300">{u.scans_count}</td>
                    <td className="py-3 text-gray-500 dark:text-gray-400">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">No users yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-500" />
            Recent Activity
          </h2>
        </CardHeader>
        <CardContent>
          {recent_activity.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {recent_activity.map((event) => {
                const info = EVENT_LABELS[event.event_type] || { label: event.event_type, icon: '📋', color: 'text-gray-600' };
                return (
                  <div key={event.id} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <span className="text-lg">{info.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium text-sm ${info.color}`}>{info.label}</span>
                      <span className="text-gray-400 mx-2">by</span>
                      <span className="text-sm text-gray-700 dark:text-gray-300">{event.user_email}</span>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(event.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
