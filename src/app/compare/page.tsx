import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, ShieldCheck, Check, Minus } from 'lucide-react';

export const metadata: Metadata = {
  title: 'How ConfigCheck compares — ConfigCheck',
  description:
    'Honest comparison of ConfigCheck vs enterprise Salesforce audit platforms vs manual audits — time to first audit, setup complexity, AI suggestions, per-org pricing.',
  alternates: { canonical: '/compare' },
};

interface Row {
  label: string;
  configcheck: string | { ok: true } | { ok: false };
  enterprise: string | { ok: true } | { ok: false };
  manual: string | { ok: true } | { ok: false };
  note?: string;
}

const rows: Row[] = [
  {
    label: 'Time to first audit',
    configcheck: '~5 minutes (signup → OAuth → scan)',
    enterprise: '4–8 weeks (procurement, MSA, SOW)',
    manual: '3–5 days per org',
  },
  {
    label: 'Setup complexity',
    configcheck: 'OAuth consent, no install',
    enterprise: 'Managed package install + admin training',
    manual: 'Spreadsheet template, none',
  },
  {
    label: 'Managed package required',
    configcheck: { ok: false },
    enterprise: { ok: true },
    manual: { ok: false },
  },
  {
    label: 'Read-only OAuth scope',
    configcheck: { ok: true },
    enterprise: 'Varies — most require write scopes',
    manual: 'N/A',
  },
  {
    label: 'AI fix suggestions per finding',
    configcheck: { ok: true },
    enterprise: 'Some — quality varies',
    manual: { ok: false },
  },
  {
    label: 'White-label PDF report',
    configcheck: { ok: true },
    enterprise: { ok: true },
    manual: 'Hand-written',
  },
  {
    label: 'Sandbox + Production support',
    configcheck: { ok: true },
    enterprise: { ok: true },
    manual: { ok: true },
  },
  {
    label: 'Per-org pricing',
    configcheck: 'From $0 (Free) — $49/mo (Pro)',
    enterprise: '$10k–$50k+/year',
    manual: 'Consultant time + opportunity cost',
  },
  {
    label: 'Cancel anytime',
    configcheck: { ok: true },
    enterprise: 'Annual contracts typical',
    manual: 'N/A',
  },
  {
    label: 'Self-serve trial',
    configcheck: { ok: true, label: '14-day Pro trial, free tier indefinitely' } as unknown as { ok: true },
    enterprise: 'Sales-led, gated',
    manual: 'N/A',
  },
];

function Cell({
  value,
}: {
  value: Row['configcheck'];
}) {
  if (typeof value === 'string') {
    return <span className="text-sm text-gray-700 dark:text-gray-300">{value}</span>;
  }
  if (value.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 font-medium">
        <Check className="h-4 w-4 flex-shrink-0" />
        Yes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-500">
      <Minus className="h-4 w-4 flex-shrink-0" />
      No
    </span>
  );
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#5B9BF3' }}>
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">ConfigCheck</span>
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

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">How ConfigCheck compares</h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-3xl leading-relaxed">
            Honest comparison of ConfigCheck against enterprise Salesforce audit
            platforms and manual audit work. We don&rsquo;t name competitors here
            because (a) their pricing and feature sets change frequently and (b) we
            don&rsquo;t want to misrepresent what they do. The &ldquo;Enterprise
            platform&rdquo; column reflects the typical shape of platforms in this
            space &mdash; verify specifics with each vendor.
          </p>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-gray-800">
                <th className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 pb-3 pr-6 align-bottom">
                  &nbsp;
                </th>
                <th className="pb-3 pr-6 align-bottom">
                  <div className="text-base font-bold text-blue-700 dark:text-blue-400">ConfigCheck</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-normal">$0–$49/mo &middot; self-serve</div>
                </th>
                <th className="pb-3 pr-6 align-bottom">
                  <div className="text-base font-bold text-gray-700 dark:text-gray-300">Enterprise platform</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-normal">$10k+/year &middot; SOW-driven</div>
                </th>
                <th className="pb-3 align-bottom">
                  <div className="text-base font-bold text-gray-700 dark:text-gray-300">Manual audit</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-normal">Spreadsheet checklists</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-gray-100 dark:border-gray-800/60">
                  <td className="py-4 pr-6 text-sm font-semibold text-gray-900 dark:text-white align-top">
                    {r.label}
                  </td>
                  <td className="py-4 pr-6 align-top">
                    <Cell value={r.configcheck} />
                  </td>
                  <td className="py-4 pr-6 align-top">
                    <Cell value={r.enterprise} />
                  </td>
                  <td className="py-4 align-top">
                    <Cell value={r.manual} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50">
          <h2 className="text-lg font-semibold mb-2">When manual audits still win</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
            Nothing replaces a senior architect&rsquo;s judgement on nuanced
            architectural decisions: should this be a flow vs an Apex trigger, is
            this bundle structure going to scale, does this org need a CPQ-Billing
            integration redesign? Manual reviews remain essential for those.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            What ConfigCheck handles is the <em>repetitive checklist portion</em>
            {' '}of an audit &mdash; the 182 patterns that show up across every CPQ
            implementation regardless of industry. Run the automated audit first,
            then spend your hours on the architectural questions only a human can
            answer.
          </p>
        </div>

        <div className="mt-12 p-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 text-center">
          <h2 className="text-xl font-semibold mb-2">Try it on your next audit</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            Free tier supports one org and a handful of scans per month &mdash;
            enough to evaluate without procurement signoff.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-7 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm"
            >
              Connect a sandbox
            </Link>
            {/* TODO: replace with real PDF — generate one anonymized sample report and host at /sample-report.pdf */}
            <a
              href="/sample-report.pdf"
              className="inline-flex items-center gap-2 px-7 py-3 text-base font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 transition-all"
            >
              View sample report &rarr;
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
