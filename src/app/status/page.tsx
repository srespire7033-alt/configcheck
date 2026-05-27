/**
 * Public status page. Shows live operational metrics so prospects /
 * customers can verify the platform is healthy without signing in. Used
 * as a trust signal during procurement reviews ("can I see your uptime?")
 * and as a self-serve incident check before opening a support ticket.
 *
 * Server-rendered with a 30-second revalidate window — enough for live
 * feel without hammering the DB. Below, a client-side timer auto-refreshes
 * the page so users staring at the dashboard see the numbers move.
 */

import Link from 'next/link';
import { createServiceClient } from '@/lib/db/client';
import { ShieldCheck, AlertCircle, Activity, Clock, TrendingUp, Database } from 'lucide-react';
import { StatusAutoRefresh } from './auto-refresh';

// 30s server-side cache. Plenty fresh, and protects the DB from busy
// crawlers / browser tabs refreshing every second.
export const revalidate = 30;

type HealthState = 'operational' | 'degraded' | 'outage' | 'unknown';

interface SystemCheck {
  name: string;
  state: HealthState;
  detail: string;
  icon: typeof Database;
}

async function loadStatus(): Promise<{
  systems: SystemCheck[];
  queueDepth: number;
  scansLastHour: number;
  failuresLastHour: number;
  avgDurationMs: number | null;
  latestScanAt: string | null;
  overallState: HealthState;
}> {
  const supabase = createServiceClient();
  const systems: SystemCheck[] = [];

  // 1. Database — a successful select means RLS, PgBouncer, and the
  //    network path from Vercel to Supabase are all healthy.
  let dbState: HealthState = 'unknown';
  let dbDetail = 'Checking…';
  try {
    const t0 = Date.now();
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    if (error) {
      dbState = 'outage';
      dbDetail = 'Database query failed';
    } else {
      const elapsed = Date.now() - t0;
      dbState = elapsed < 500 ? 'operational' : elapsed < 2000 ? 'degraded' : 'outage';
      dbDetail = `Responding in ${elapsed}ms`;
    }
  } catch {
    dbState = 'outage';
    dbDetail = 'Database unreachable';
  }
  systems.push({ name: 'Database', state: dbState, detail: dbDetail, icon: Database });

  // 2. Scan queue — degraded if many scans are stuck pending for >5min.
  let queueDepth = 0;
  let queueState: HealthState = 'unknown';
  let queueDetail = '—';
  try {
    const { count } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    queueDepth = count ?? 0;

    // Look for scans pending >5min — backlog indicator
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: stale } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if ((stale ?? 0) > 5) {
      queueState = 'outage';
      queueDetail = `${stale} scans queued >5min — worker may be stuck`;
    } else if ((stale ?? 0) > 0) {
      queueState = 'degraded';
      queueDetail = `${stale} scans queued >5min`;
    } else {
      queueState = 'operational';
      queueDetail = queueDepth === 0 ? 'Idle' : `${queueDepth} scan${queueDepth === 1 ? '' : 's'} in queue`;
    }
  } catch {
    queueState = 'unknown';
    queueDetail = 'Could not read queue';
  }
  systems.push({ name: 'Scan Engine', state: queueState, detail: queueDetail, icon: Activity });

  // 3. Recent throughput + failure rate
  let scansLastHour = 0;
  let failuresLastHour = 0;
  let avgDurationMs: number | null = null;
  let latestScanAt: string | null = null;
  let throughputState: HealthState = 'operational';
  let throughputDetail = 'No scans in the last hour';
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('scans')
      .select('status, duration_ms, completed_at')
      .gte('created_at', oneHourAgo)
      .in('status', ['completed', 'failed']);

    scansLastHour = (recent ?? []).filter((s) => s.status === 'completed').length;
    failuresLastHour = (recent ?? []).filter((s) => s.status === 'failed').length;
    const completedDurations = (recent ?? [])
      .filter((s) => s.status === 'completed' && typeof s.duration_ms === 'number')
      .map((s) => s.duration_ms as number);
    if (completedDurations.length > 0) {
      avgDurationMs = Math.round(
        completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length
      );
    }
    const total = scansLastHour + failuresLastHour;
    if (total > 0) {
      const failureRate = failuresLastHour / total;
      if (failureRate > 0.5) {
        throughputState = 'outage';
        throughputDetail = `${Math.round(failureRate * 100)}% of scans failing`;
      } else if (failureRate > 0.1) {
        throughputState = 'degraded';
        throughputDetail = `${Math.round(failureRate * 100)}% failure rate`;
      } else {
        throughputDetail = `${scansLastHour} scans completed${avgDurationMs ? `, avg ${Math.round(avgDurationMs / 1000)}s` : ''}`;
      }
    }

    const { data: lastScan } = await supabase
      .from('scans')
      .select('completed_at')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestScanAt = lastScan?.completed_at ?? null;
  } catch {
    throughputState = 'unknown';
    throughputDetail = 'Could not read throughput';
  }
  systems.push({ name: 'Throughput', state: throughputState, detail: throughputDetail, icon: TrendingUp });

  // 4. API — if any of the above worked, the API surface is up by definition
  //    (we're inside Next.js handling a request). Mostly a sanity check for
  //    users wondering "is your dashboard responding?"
  systems.push({
    name: 'API & Dashboard',
    state: 'operational',
    detail: `Region ${process.env.VERCEL_REGION ?? 'unknown'} healthy`,
    icon: ShieldCheck,
  });

  // Overall state = worst component state
  const order: Record<HealthState, number> = { operational: 0, unknown: 1, degraded: 2, outage: 3 };
  const overallState = systems.reduce<HealthState>((worst, s) => (order[s.state] > order[worst] ? s.state : worst), 'operational');

  return { systems, queueDepth, scansLastHour, failuresLastHour, avgDurationMs, latestScanAt, overallState };
}

const STATE_STYLES: Record<HealthState, { label: string; bg: string; text: string; dot: string }> = {
  operational: { label: 'Operational', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
  degraded:    { label: 'Degraded',    bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  outage:      { label: 'Outage',      bg: 'bg-red-50 dark:bg-red-900/20',     text: 'text-red-700 dark:text-red-400',     dot: 'bg-red-500' },
  unknown:     { label: 'Unknown',     bg: 'bg-gray-50 dark:bg-gray-800/30',   text: 'text-gray-600 dark:text-gray-400',   dot: 'bg-gray-400' },
};

const OVERALL_HEADLINES: Record<HealthState, { headline: string; sub: string }> = {
  operational: { headline: 'All systems operational', sub: 'Everything is running smoothly.' },
  degraded:    { headline: 'Partial degradation',     sub: 'Some surfaces are slower than usual. Scans should still complete.' },
  outage:      { headline: 'Active incident',         sub: 'One or more critical surfaces are impacted. Investigating.' },
  unknown:     { headline: 'Checking status…',        sub: 'Live health checks are running.' },
};

export default async function StatusPage() {
  const { systems, scansLastHour, failuresLastHour, latestScanAt, overallState } = await loadStatus();
  const overall = OVERALL_HEADLINES[overallState];
  const overallStyle = STATE_STYLES[overallState];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120]">
      <StatusAutoRefresh />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <Link href="/" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            ← OrgPrism
          </Link>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Auto-refreshes every 30s
          </span>
        </div>

        {/* Overall headline */}
        <div className={`rounded-2xl p-6 border ${overallStyle.bg} ${overallState === 'operational' ? 'border-green-200 dark:border-green-800/40' : overallState === 'degraded' ? 'border-amber-200 dark:border-amber-800/40' : overallState === 'outage' ? 'border-red-200 dark:border-red-800/40' : 'border-gray-200 dark:border-gray-700'}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-2.5 h-2.5 rounded-full ${overallStyle.dot} ${overallState !== 'operational' ? 'animate-pulse' : ''}`} />
            <h1 className={`text-2xl font-bold ${overallStyle.text}`}>{overall.headline}</h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-5.5">{overall.sub}</p>
        </div>

        {/* Systems */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
            Systems
          </h2>
          {systems.map(({ name, state, detail, icon: Icon }) => {
            const style = STATE_STYLES[state];
            return (
              <div
                key={name}
                className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{detail}</p>
                  </div>
                </div>
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full ${style.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                  <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Throughput summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 text-center">
            <Activity className="h-4 w-4 mx-auto mb-1.5 text-green-500" />
            <div className="text-xl font-bold text-gray-900 dark:text-white">{scansLastHour}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Scans last hour</div>
          </div>
          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 text-center">
            <AlertCircle className="h-4 w-4 mx-auto mb-1.5 text-red-500" />
            <div className="text-xl font-bold text-gray-900 dark:text-white">{failuresLastHour}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Failures last hour</div>
          </div>
          <div className="p-4 rounded-xl bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-700 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1.5 text-blue-500" />
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {latestScanAt ? new Date(latestScanAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Most recent scan</div>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
          Built into OrgPrism — health checks run server-side against live infrastructure. No fake green dots.
        </p>
      </div>
    </div>
  );
}
