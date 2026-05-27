'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  Users,
  Scan,
  Sparkles,
  FileText,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface AnalyticsData {
  window_days: number;
  kpis: {
    total_events: number;
    distinct_users: number;
    distinct_anonymous: number;
    scans_completed: number;
    scans_failed: number;
    pdfs_downloaded: number;
    ai_calls: number;
    orgs_disconnected: number;
  };
  funnel: Array<{ stage: string; count: number }>;
  events_by_day: Array<Record<string, number | string>>;
  top_events: Array<{ event_name: string; count: number }>;
}

const PERIODS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

// Subset of events worth charting individually on the time series. Anything
// noisy (e.g. modal_opened firing on every visit) gets the bigger picture
// in `top_events` table instead.
const TIMESERIES_EVENTS = [
  { key: 'scan_completed', label: 'Scans completed', color: '#10b981' },
  { key: 'scan_failed', label: 'Scans failed', color: '#ef4444' },
  { key: 'oauth_callback_success', label: 'Orgs connected', color: '#3b82f6' },
  { key: 'ai_fix_used', label: 'AI fix', color: '#a855f7' },
  { key: 'pdf_report_downloaded', label: 'PDFs', color: '#f59e0b' },
] as const;

export default function AnalyticsAdminPage() {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/admin/analytics?days=${days}`)
      .then((res) => {
        if (res.status === 403) {
          router.push('/dashboard');
          return null;
        }
        if (!res.ok) throw new Error('Failed to load analytics');
        return res.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [days, router]);

  // Build a fill-in series so the chart shows zero-days as zero rather than
  // skipping them — keeps the X axis evenly spaced.
  const series = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Record<string, number | string>>();
    for (const row of data.events_by_day) map.set(row.day as string, row);
    const out: Array<Record<string, number | string>> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const existing = map.get(key) ?? {};
      const filled: Record<string, number | string> = { day: key.slice(5) };
      for (const e of TIMESERIES_EVENTS) filled[e.key] = (existing[e.key] as number) ?? 0;
      out.push(filled);
    }
    return out;
  }, [data, days]);

  if (loading && !data) return <LoadingScreen />;
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>;
  if (!data) return null;

  const { kpis, funnel, top_events } = data;
  const funnelTop = funnel[0]?.count ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Back to admin"
          >
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </Link>
          <div className="p-2 bg-blue-600 rounded-lg">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Product Analytics</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Self-hosted event tracking — last {data.window_days} days
            </p>
          </div>
        </div>
        {/* Period switcher */}
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === p.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards. Full class strings (not interpolated) so Tailwind's JIT
          can see them at build time. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {[
          { label: 'Events', value: kpis.total_events, icon: Activity,
            bg: 'bg-gray-50 dark:bg-gray-800/40', fg: 'text-gray-600 dark:text-gray-300' },
          { label: 'Users', value: kpis.distinct_users, icon: Users,
            bg: 'bg-blue-50 dark:bg-blue-900/20', fg: 'text-blue-600 dark:text-blue-400' },
          { label: 'Anon visitors', value: kpis.distinct_anonymous, icon: Users,
            bg: 'bg-cyan-50 dark:bg-cyan-900/20', fg: 'text-cyan-600 dark:text-cyan-400' },
          { label: 'Scans done', value: kpis.scans_completed, icon: Scan,
            bg: 'bg-green-50 dark:bg-green-900/20', fg: 'text-green-600 dark:text-green-400' },
          { label: 'AI calls', value: kpis.ai_calls, icon: Sparkles,
            bg: 'bg-purple-50 dark:bg-purple-900/20', fg: 'text-purple-600 dark:text-purple-400' },
          { label: 'PDFs', value: kpis.pdfs_downloaded, icon: FileText,
            bg: 'bg-amber-50 dark:bg-amber-900/20', fg: 'text-amber-600 dark:text-amber-400' },
          { label: 'Scan failures', value: kpis.scans_failed, icon: XCircle,
            bg: 'bg-red-50 dark:bg-red-900/20', fg: 'text-red-600 dark:text-red-400' },
        ].map(({ label, value, icon: Icon, bg, fg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
            <Icon className={`h-5 w-5 mx-auto mb-1.5 ${fg}`} />
            <div className={`text-2xl font-bold ${fg}`}>{value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowRight className="h-5 w-5 text-blue-500" />
            Activation Funnel
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Distinct visitors (signed-in + anonymous) that hit each stage in the last{' '}
            {data.window_days} days. Drop-off after &quot;Opened connect modal&quot; is where
            onboarding pain lives.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {funnel.map((stage, i) => {
              const pct = funnelTop > 0 ? Math.round((stage.count / funnelTop) * 100) : 0;
              const fromPrev =
                i > 0 && funnel[i - 1].count > 0
                  ? Math.round((stage.count / funnel[i - 1].count) * 100)
                  : null;
              return (
                <div key={stage.stage}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {stage.stage}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">
                        {stage.count}
                      </span>
                      <span className="ml-2 text-xs">
                        {pct}% of top
                        {fromPrev !== null && (
                          <span
                            className={`ml-2 ${
                              fromPrev < 50
                                ? 'text-red-500'
                                : fromPrev < 80
                                  ? 'text-amber-500'
                                  : 'text-green-600'
                            }`}
                          >
                            ({fromPrev}% from prev)
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {funnelTop === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">
                No funnel activity in this window yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Time series */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Key Events Over Time
          </h2>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {TIMESERIES_EVENTS.map((e) => (
                  <Line
                    key={e.key}
                    type="monotone"
                    dataKey={e.key}
                    name={e.label}
                    stroke={e.color}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top events table */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            All Events ({data.window_days}d)
          </h2>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 font-medium">Event</th>
                  <th className="pb-2 font-medium text-right">Count</th>
                  <th className="pb-2 font-medium text-right">% of total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {top_events.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-gray-500 dark:text-gray-400">
                      No events captured in this window yet.
                    </td>
                  </tr>
                ) : (
                  top_events.map((row) => {
                    const pct =
                      kpis.total_events > 0
                        ? ((row.count / kpis.total_events) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <tr key={row.event_name}>
                        <td className="py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                          {row.event_name}
                        </td>
                        <td className="py-2.5 text-right font-mono text-gray-900 dark:text-white">
                          {row.count.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right text-gray-500 dark:text-gray-400">
                          {pct}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
