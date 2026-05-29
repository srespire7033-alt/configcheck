import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { LogoMark } from '@/components/ui/logo';
import { allChecks } from '@/lib/analysis/checks';
import { allBillingChecks } from '@/lib/analysis/billing-checks';
import { armChecks } from '@/lib/analysis/arm-checks';
import { TOTAL_CHECKS } from '@/lib/analysis/constants';
import { getCategoryLabel } from '@/lib/utils';
import type { IssueSeverity } from '@/types';

export const metadata: Metadata = {
  title: `All ${TOTAL_CHECKS} Health Checks — OrgPrism`,
  description:
    `The complete inventory of OrgPrism health checks: ${allChecks.length} Salesforce CPQ + ${allBillingChecks.length} Billing + ${armChecks.length} Revenue Cloud (ARM) — every check name, category, and severity.`,
  alternates: { canonical: '/checks' },
};

interface CheckRow {
  id: string;
  name: string;
  category: string;
  severity: IssueSeverity;
  description: string;
}

function toRow(c: { id: string; name: string; category: string; severity: IssueSeverity; description: string }): CheckRow {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    severity: c.severity,
    description: c.description,
  };
}

const severityConfig: Record<IssueSeverity, { label: string; cls: string; Icon: typeof AlertCircle }> = {
  critical: {
    label: 'Critical',
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    Icon: AlertCircle,
  },
  warning: {
    label: 'Warning',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    Icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    Icon: Info,
  },
};

function ChecksGroup({
  title,
  product,
  accent,
  checks,
}: {
  title: string;
  product: 'CPQ' | 'Billing' | 'ARM';
  accent: 'blue' | 'purple' | 'teal';
  checks: CheckRow[];
}) {
  // Group by category for display
  const byCat: Record<string, CheckRow[]> = {};
  for (const c of checks) {
    if (!byCat[c.category]) byCat[c.category] = [];
    byCat[c.category].push(c);
  }
  const categories = Object.keys(byCat).sort();

  const headerCls =
    accent === 'blue'
      ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-200/60 dark:ring-blue-500/20'
      : accent === 'purple'
      ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-purple-200/60 dark:ring-purple-500/20'
      : 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-200/60 dark:ring-teal-500/20';

  return (
    <section id={product.toLowerCase()} className="mb-16">
      <div
        className={`flex items-baseline gap-3 mb-6 px-5 py-4 rounded-xl ring-1 ${headerCls}`}
      >
        <span className="text-3xl font-bold">{checks.length}</span>
        <span className="text-xs font-bold uppercase tracking-wider">{product}</span>
        <span className="text-sm opacity-80 ml-auto">{categories.length} categories &middot; {title}</span>
      </div>

      <div className="space-y-8">
        {categories.map((cat) => (
          <div key={cat}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
              {getCategoryLabel(cat)}{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({byCat[cat].length})</span>
            </h3>
            <div className="bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {byCat[cat]
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((c) => {
                  const sev = severityConfig[c.severity];
                  const SevIcon = sev.Icon;
                  return (
                    <div key={c.id} className="px-5 py-4 flex items-start gap-4">
                      <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5 w-16">
                        {c.id}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${sev.cls}`}
                          >
                            <SevIcon className="w-3 h-3" />
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{c.description}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ChecksPage() {
  // toRow only needs the metadata fields (id, name, category, severity,
  // description) — drop `run` and any other check-engine internals before
  // passing to the UI layer.
  const cpqRows = allChecks.map((c) => toRow({ id: c.id, name: c.name, category: c.category, severity: c.severity, description: c.description }));
  const billingRows = allBillingChecks.map((c) =>
    toRow({ id: c.id, name: c.name, category: c.category, severity: c.severity, description: c.description })
  );
  const armRows = armChecks.map((c) =>
    toRow({ id: c.id, name: c.name, category: c.category, severity: c.severity, description: c.description })
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">All {TOTAL_CHECKS} health checks</h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-3xl leading-relaxed">
            Every check OrgPrism runs across Salesforce CPQ, Billing, and Revenue Cloud (ARM).
            Severity classifies how serious each finding is &mdash; Critical breaks something at runtime,
            Warning is a misconfiguration smell, Info is a best-practice nudge.
          </p>
        </div>

        {/* Quick-jump anchor strip */}
        <div className="flex flex-wrap gap-2 mb-12 text-sm">
          <a href="#cpq" className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20 font-medium transition-colors">
            Jump to CPQ ({cpqRows.length})
          </a>
          <a href="#billing" className="px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 font-medium transition-colors">
            Jump to Billing ({billingRows.length})
          </a>
          <a href="#arm" className="px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-500/20 font-medium transition-colors">
            Jump to ARM ({armRows.length})
          </a>
        </div>

        <ChecksGroup title="Salesforce CPQ" product="CPQ" accent="blue" checks={cpqRows} />
        <ChecksGroup title="Salesforce Billing" product="Billing" accent="purple" checks={billingRows} />
        <ChecksGroup title="Revenue Cloud (ARM)" product="ARM" accent="teal" checks={armRows} />

        <div className="mt-16 p-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 text-center">
          <h2 className="text-xl font-semibold mb-2">Want to see these run on a real org?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Connect a sandbox in 60 seconds. Read-only OAuth, no managed package, disconnect anytime.
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
