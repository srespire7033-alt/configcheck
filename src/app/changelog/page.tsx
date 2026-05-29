import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '@/components/ui/logo';

export const metadata: Metadata = {
  title: 'Changelog — OrgPrism',
  description:
    'What\'s new in OrgPrism. Recent additions to the health-check catalog, dashboard improvements, and platform updates.',
  alternates: { canonical: '/changelog' },
};

interface Entry {
  date: string; // ISO date
  tag?: 'New' | 'Improvement' | 'Fix';
  title: string;
  body: string;
  bullets?: string[];
}

const entries: Entry[] = [
  {
    date: '2026-05-29',
    tag: 'New',
    title: 'Coverage milestone — 209 health checks across 49 categories',
    body:
      'The catalog grew to 209 checks (92 CPQ + 39 Billing + 78 Revenue Cloud/ARM). Numbers across the homepage, dashboard, scan results and OG meta tags now read from a single source of truth in `src/lib/analysis/constants.ts`, with a drift-guard test that fails CI if anyone adds a check without bumping the count. Marketing numbers can never silently go stale again.',
    bullets: [
      'New ARM-002b — flags active products with no PricebookEntry AND no RateCardEntry (the truly unsellable case ARM-001 missed)',
      'ARM check suite hardened against missing data — 24 previously-silent false-negatives now run cleanly',
      'Test suite grew to 1,163 unit tests, all passing on every commit',
    ],
  },
  {
    date: '2026-05-29',
    tag: 'New',
    title: 'BYO External Client App — permanent OAuth connections',
    body:
      'OrgPrism now uses Bring-Your-Own External Client App for OAuth: each customer creates an ECA inside their own Salesforce org, so refresh tokens issued by that ECA work indefinitely. The shared-platform-ECA model previously caused refresh failures roughly every 2 hours, requiring daily reconnects — Path C is now proven working end-to-end with scans completing in 3 seconds against 12+ hour idle tokens.',
    bullets: [
      'Pre-flight credentials test button validates Consumer Key, Login URL, and callback URL before the OAuth round-trip',
      'Per-org login URL safety — the gateway-vs-MyDomain mistake that broke 2 of 3 test orgs is now blocked at the modal',
      'One-click Migrate button for legacy connections (preserves scan history)',
    ],
  },
  {
    date: '2026-05-29',
    tag: 'Improvement',
    title: 'AI summary deferred — scans complete 5–7× faster',
    body:
      'Executive summary and remediation plan generation moved to a deferred background step that runs after the scan is marked completed. Users see issues and score immediately (3 seconds for the data fetch + 152-check engine + DB write), while the AI prose fills in over the next 5–25 seconds. A Gemini outage now affects only the prose layer — issues, scores, and metadata stay safe.',
  },
  {
    date: '2026-05-29',
    tag: 'New',
    title: 'Public /status page + self-hosted product analytics',
    body:
      'Live health probes at /status — database latency, scan queue depth, hourly throughput, and last-completed-scan timestamp. All metrics computed server-side against the actual infrastructure. Replaces what would otherwise be openstatus.dev / instatus.com at $9–29/mo. Companion admin /admin/analytics dashboard reads from a self-hosted analytics_events table — funnel data stays in our own Supabase, no third-party PII flow.',
  },
  {
    date: '2026-05-01',
    tag: 'Improvement',
    title: 'Smarter price-rule evaluation order check',
    body:
      'Rebuilt PR-003: gaps in evaluation order are deliberate Salesforce best practice (10, 20, 30 lets you slot in 15 later without resequencing) and shouldn\'t fire as findings. The new PR-003 instead detects the actionable smell — multiple active rules sharing the same evaluation order, which makes execution non-deterministic.',
  },
  {
    date: '2026-05-01',
    tag: 'Improvement',
    title: 'Issue modal groups duplicate-looking findings',
    body:
      'When a single check fires on multiple records (e.g. PR-002 "Price Rule with no conditions" hitting 5 different rules), the category modal now collapses them under one expandable header showing the count. Click to expand and see the underlying records, each still individually mark-fixable.',
  },
  {
    date: '2026-04-30',
    tag: 'New',
    title: 'Revenue Cloud (ARM) scan support — 51 checks across 16 categories',
    body:
      'OrgPrism now scans full Revenue Cloud / RLM orgs, not just CPQ + Billing. ARM coverage spans the entire revenue lifecycle: catalog, selling models, price adjustments, attribute pricing, bundles, pricing procedures, price books, decision tables, context service, rate cards, attributes, assets, contracts, usage management, orchestration (DRO), and cost books.',
    bullets: [
      'Detects active products without an assigned ProductSellingModel',
      'Flags bundles with impossible quantity ranges (Min > Max)',
      'Catches assets with multiple "current" state periods',
      'Surfaces contracts with reversed start/end dates',
    ],
  },
  {
    date: '2026-04-30',
    tag: 'New',
    title: 'Feedback learning loop',
    body:
      'You can now mark a finding as "False Positive" or "Not Relevant" alongside the existing "Mark Fixed". False positives suppress that check on that org for future scans. Aggregate signals across all users surface as a "% helpful" trust score on each finding (after enough feedback accumulates) so the community of consultants gradually tunes the catalog for everyone.',
  },
  {
    date: '2026-04-30',
    tag: 'Improvement',
    title: 'Dashboard empty state + live scan progress',
    body:
      'The dashboard\'s first-time empty state now teaches what\'s about to happen — a 3-step OAuth → scan → review walk-through with a security strip beneath. While a scan is running, each org card shows a 5-phase progress bar (Connect → Detect packages → Fetch data → Run checks → Generate AI summary) instead of a generic spinner.',
  },
  {
    date: '2026-04-30',
    tag: 'Fix',
    title: 'Stale data fixed across all read endpoints',
    body:
      'Resolved a class of bugs where the dashboard could show last-week\'s scan score even after running a fresh one, caused by PostgREST caching responses across requests. Every read path now sends explicit no-cache headers; the affected org cards refresh on window focus too.',
  },
  {
    date: '2026-04-30',
    tag: 'New',
    title: 'Team invitation emails',
    body:
      'Inviting a teammate now sends a real email with a one-click acceptance link, instead of just logging the URL to console. Mirrors the existing welcome and scan-completion email styling.',
  },
  {
    date: '2026-04-17',
    tag: 'New',
    title: 'Severity completeness sweep — 21 new CPQ checks',
    body:
      'Every CPQ category now has at least one Critical, one Warning, and one Info-level check, so a clean scan really means clean across all severities. New checks span Bundle Integrity (BN-001 to BN-005) and Lookup Query patterns (LQ-001 to LQ-005), among others.',
  },
  {
    date: '2026-04-17',
    tag: 'Improvement',
    title: 'Welcome email + auto-signin after confirmation',
    body:
      'New signup flow: confirm your email and you\'re signed in automatically — no second login screen. The welcome email itself was redesigned with a brand-bar header, primary CTA, and a plaintext fallback for clients that don\'t render HTML.',
  },
  {
    date: '2026-04-16',
    tag: 'New',
    title: 'Disconnect org from the dashboard',
    body:
      'Each org card now has a 3-dot menu with a "Disconnect Org" action. Confirms before deleting and removes the OAuth token, all scan history, and cached data for that org.',
  },
];

const tagStyle: Record<NonNullable<Entry['tag']>, string> = {
  New: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Improvement: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Fix: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-white">
            <LogoMark size={36} />
            <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">OrgPrism</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Changelog</h1>
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
            What&rsquo;s new in OrgPrism. Subscribe to product updates by emailing{' '}
            {/* TODO: replace with the live mailbox once orgprism.app is wired up */}
            <a href="mailto:hello@orgprism.app" className="text-blue-600 dark:text-blue-400 hover:underline">
              hello@orgprism.app
            </a>{' '}
            with the subject line &ldquo;changelog&rdquo;.
          </p>
        </div>

        <div className="space-y-10">
          {entries.map((e, i) => (
            <article
              key={i}
              className="border-l-2 border-gray-200 dark:border-gray-800 pl-6 relative"
            >
              {/* Dot on the timeline */}
              <span className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-blue-500" />
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {formatDate(e.date)}
                </span>
                {e.tag && (
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${tagStyle[e.tag]}`}
                  >
                    {e.tag}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold mb-2">{e.title}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{e.body}</p>
              {e.bullets && (
                <ul className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                  {e.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">&bull;</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>

        <div className="mt-16 p-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 text-center">
          <h2 className="text-lg font-semibold mb-2">Want to try the latest?</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
            Connect a sandbox in 60 seconds. Read-only OAuth, no managed package.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm"
          >
            Connect a sandbox
          </Link>
        </div>
      </main>
    </div>
  );
}
