'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TOTAL_CHECKS, TOTAL_CATEGORIES } from '@/lib/analysis/constants';
import {
  Zap,
  FileText,
  ArrowRight,
  CheckCircle,
  Cloud,
  GitCompare,
  Sparkles,
  Lock,
  ChevronRight,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { LogoMark } from '@/components/ui/logo';

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Force light theme on the public landing page regardless of the user's
  // saved preference. The marketing surface is designed for light mode only;
  // a logged-in user who flipped to dark inside the app shouldn't drag that
  // theme onto the landing when they log out / browse the homepage. We do
  // NOT touch localStorage — the user's preference is preserved for when
  // they go back into the app.
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) document.documentElement.classList.remove('dark');
    return () => {
      // Restore on unmount so navigating into /dashboard etc. picks up the
      // saved preference again.
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') document.documentElement.classList.add('dark');
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-gray-100">
      {/* ═══ NAVBAR ═══ */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-white/80 dark:bg-[#0b1120]/80 backdrop-blur-xl shadow-sm border-b border-gray-200/50 dark:border-gray-800/50'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-white">
            <LogoMark size={36} />
            <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">OrgPrism</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-600 dark:text-gray-400">
            <a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-gray-900 dark:hover:text-white transition-colors">How It Works</a>
            <a href="#checks" className="hover:text-gray-900 dark:hover:text-white transition-colors">Health Checks</a>
            <a href="#pricing" className="hover:text-gray-900 dark:hover:text-white transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-2"
            >
              Sign In
            </Link>
            <Link
              href="/login"
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-xl transition-all duration-200 shadow-sm shadow-blue-600/30 hover:shadow-md hover:shadow-blue-600/40"
            >
              Connect a sandbox
            </Link>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background decoration — brand color blobs at low opacity create
            an ambient atmosphere without competing with copy. The four
            blobs roughly trace the four logo facets (purple, orange, sky,
            indigo) but blurred so the eye reads them as a single mood. */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-gradient-to-b from-brand-sky/[0.10] dark:from-brand-sky/[0.06] to-transparent rounded-full blur-3xl" />
          <div className="absolute top-32 -left-20 w-80 h-80 bg-brand-purple/[0.12] dark:bg-brand-purple/[0.08] rounded-full blur-3xl" />
          <div className="absolute top-52 -right-24 w-96 h-96 bg-brand-indigo/[0.10] dark:bg-brand-indigo/[0.06] rounded-full blur-3xl" />
          <div className="absolute top-[28rem] left-1/3 w-72 h-72 bg-brand-orange/[0.08] dark:bg-brand-orange/[0.05] rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          {/* Eyebrow tag — names the wedge in 5 words */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400 text-sm font-medium mb-8">
            <Sparkles className="h-4 w-4" />
            Beta &middot; {TOTAL_CHECKS} checks &middot; OAuth read-only
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.1] max-w-5xl mx-auto">
            The Revenue Cloud audit that doesn&rsquo;t need a{' '}
            <span className="bg-gradient-to-r from-brand-purple via-brand-sky to-brand-indigo bg-clip-text text-transparent">
              6-week SOW
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Connect your Salesforce org, get {TOTAL_CHECKS} CPQ + Billing + ARM health checks with AI fix
            suggestions in under 30 seconds. Built for consultants who quote audits in days, not quarters.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 hover:-translate-y-0.5 w-full sm:w-auto justify-center"
            >
              Connect a sandbox
              <ArrowRight className="h-5 w-5" />
            </Link>
            {/* TODO: replace with real PDF — generate one anonymized sample report and host at /sample-report.pdf */}
            <a
              href="/sample-report.pdf"
              className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 transition-all duration-200 w-full sm:w-auto justify-center"
            >
              View sample report &rarr;
            </a>
          </div>

          {/* Hero product visual — placeholder mockup of the post-scan dashboard.
              For a SaaS audit tool, visitors want to see the dashboard, a sample
              finding, and the AI fix UI before signing up. Pure-text heroes
              underperform.
              TODO: replace with a real screenshot or short looping screencap once
              the production UI is polished enough to feature. */}
          <div className="relative max-w-4xl mx-auto mb-16">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20 blur-3xl" />
            <div className="relative bg-white dark:bg-gray-900/80 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl p-6 md:p-8 backdrop-blur">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500">
                    <Cloud className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-sm">Acme Corp Sandbox</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Last scan: 2m ago &middot; CPQ + Billing + ARM</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-emerald-600">87</div>
                  <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Health /100</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 border border-red-100 dark:border-red-900/40">
                  <div className="text-2xl font-bold text-red-600">3</div>
                  <div className="text-xs text-red-700 dark:text-red-400">Critical</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-100 dark:border-amber-900/40">
                  <div className="text-2xl font-bold text-amber-600">11</div>
                  <div className="text-xs text-amber-700 dark:text-amber-400">Warnings</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/40">
                  <div className="text-2xl font-bold text-blue-600">8</div>
                  <div className="text-xs text-blue-700 dark:text-blue-400">Best Practice</div>
                </div>
              </div>
              <div className="space-y-2 text-left">
                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl border-l-4 border-l-red-500">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold">3 price rules with no conditions</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">PR-002</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">May apply to all quote lines unexpectedly. AI suggestion ready.</div>
                  </div>
                  <span className="hidden md:inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    <Sparkles className="w-3 h-3" /> AI fix
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl border-l-4 border-l-amber-500">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold">Discount tier overlap on &ldquo;Volume Schedule&rdquo;</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">DS-001</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Quantity 51&ndash;100 is covered by two tiers &mdash; engine resolution is non-deterministic.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-8 md:gap-16 text-center flex-wrap">
            <div>
              <div className="text-3xl font-bold text-blue-600">{TOTAL_CHECKS}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Health Checks</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
            <div>
              <div className="text-3xl font-bold text-blue-600">{TOTAL_CATEGORIES}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Categories</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
            <div>
              <div className="text-3xl font-bold text-blue-600">&lt;30s</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Full Scan</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700 hidden md:block" />
            <div className="hidden md:block">
              <div className="text-3xl font-bold text-blue-600">AI</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Fix Suggestions</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECURITY STRIP ═══
          Replaces the previous trust-badge row. Per content-v2: removed the
          vague "Enterprise-Grade Security" claim and replaced with four
          factually defensible points that a technical buyer can verify. */}
      <section className="py-6 border-t border-gray-200/60 dark:border-gray-800/60">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">&#128274; Read-only OAuth</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#128202; Metadata only, never customer records</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#128230; No managed package</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#10060; Disconnect anytime</span>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need to Audit Revenue Cloud</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              From connecting your org to delivering white-label reports, OrgPrism handles the entire audit workflow.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Cloud,
                title: 'One-Click Salesforce Connect',
                desc: 'Connect any Salesforce org with OAuth. Your data stays secure and is never stored permanently.',
                color: 'blue',
              },
              {
                icon: Zap,
                title: `${TOTAL_CHECKS} Automated Health Checks`,
                desc: `Price rules, discount schedules, products, approval rules, QCP scripts, billing rules, ARM selling models, bundles, rate cards, contracts — ${TOTAL_CATEGORIES} categories scanned automatically.`,
                color: 'amber',
              },
              {
                icon: Sparkles,
                title: 'AI-Powered Fix Suggestions',
                desc: 'Gemini AI analyzes each issue and provides step-by-step remediation guidance tailored to your configuration.',
                color: 'purple',
              },
              {
                icon: FileText,
                title: 'White-Label PDF Reports',
                desc: 'Generate branded audit reports with your company logo. Share professional deliverables with clients instantly.',
                color: 'green',
              },
              {
                icon: GitCompare,
                title: 'Scan History & Comparison',
                desc: 'Track configuration health over time. Compare scans to see what improved or regressed between audits.',
                color: 'indigo',
              },
              {
                icon: Lock,
                title: 'Enterprise-Grade Security',
                desc: 'Designed to SOC 2 standards. Read-only Salesforce access via OAuth. Data encrypted in transit and at rest.',
                color: 'red',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="group bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-7 hover:border-blue-300 dark:hover:border-blue-600/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5"
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center mb-5 ${
                    feature.color === 'blue' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600' :
                    feature.color === 'amber' ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-600' :
                    feature.color === 'purple' ? 'bg-purple-100 dark:bg-purple-500/10 text-purple-600' :
                    feature.color === 'green' ? 'bg-green-100 dark:bg-green-500/10 text-green-600' :
                    feature.color === 'indigo' ? 'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600' :
                    'bg-red-100 dark:bg-red-500/10 text-red-600'
                  }`}
                >
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section id="how-it-works" className="py-24 bg-white dark:bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Audit Any Revenue Cloud Org in 3 Steps</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              No installations, no packages. Just connect and scan.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              {
                step: '01',
                icon: Cloud,
                title: 'Connect Salesforce',
                desc: 'Authenticate with OAuth. OrgPrism uses read-only access to pull Revenue Cloud metadata — no data is modified.',
              },
              {
                step: '02',
                icon: Target,
                title: 'Run Health Scan',
                desc: '102 checks across CPQ, Billing &amp; ARM execute in under 30 seconds. Issues are ranked by severity with affected records.',
              },
              {
                step: '03',
                icon: FileText,
                title: 'Deliver Report',
                desc: 'Get AI fix suggestions, generate a white-label PDF, and share professional audit results with your clients.',
              },
            ].map((item, i) => (
              <div key={i} className="relative text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-indigo text-white mb-6 shadow-lg shadow-blue-600/20">
                  <item.icon className="h-7 w-7" />
                </div>
                <div className="text-xs font-bold text-blue-600 tracking-widest uppercase mb-3">Step {item.step}</div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">{item.desc}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 -right-6 lg:-right-4">
                    <ChevronRight className="h-6 w-6 text-gray-300 dark:text-gray-700" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HEALTH CHECKS ═══ */}
      <section id="checks" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{TOTAL_CHECKS} Health Checks Across CPQ, Billing &amp; ARM</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Every critical Revenue Cloud configuration area is covered. Issues are classified as Critical, Warning, or Info.
            </p>
          </div>

          {/* Three parent product cards with example checks. Replaces the
              long flat grid of 45 mini-tiles per task #8 — gives a visitor
              a 20-second read of what a "check" actually means in practice
              and links to /checks for the full inventory. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                product: 'Salesforce CPQ',
                badge: 'CPQ',
                count: 92,
                categories: 21,
                accent: 'blue',
                examples: [
                  'Detects price rules with conflicting conditions on the same field',
                  'Flags products missing a default subscription term',
                  'Identifies discount schedules with overlapping tier ranges',
                  'Surfaces QCP scripts with unhandled error paths',
                ],
              },
              {
                product: 'Salesforce Billing',
                badge: 'Billing',
                count: 39,
                categories: 8,
                accent: 'purple',
                examples: [
                  'Catches finance books with no period covering today',
                  'Detects products missing a billing rule reference',
                  'Surfaces GL treatments missing one side of the debit/credit pair',
                  'Flags invoices stuck in Draft for more than seven days',
                ],
              },
              {
                product: 'Revenue Cloud (ARM)',
                badge: 'ARM',
                count: 51,
                categories: 16,
                accent: 'teal',
                examples: [
                  'Detects active products without an assigned selling model',
                  'Flags bundles with impossible quantity ranges (Min > Max)',
                  'Identifies overlapping price adjustment tiers',
                  'Surfaces assets with multiple "current" state periods',
                ],
              },
            ].map((group) => {
              const accentRing = group.accent === 'blue'
                ? 'ring-blue-200 dark:ring-blue-500/30'
                : group.accent === 'purple'
                ? 'ring-purple-200 dark:ring-purple-500/30'
                : 'ring-teal-200 dark:ring-teal-500/30';
              const accentBg = group.accent === 'blue'
                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : group.accent === 'purple'
                ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300'
                : 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300';
              const numberColor = group.accent === 'blue'
                ? 'text-blue-700 dark:text-blue-400'
                : group.accent === 'purple'
                ? 'text-purple-700 dark:text-purple-400'
                : 'text-teal-700 dark:text-teal-400';
              const checkColor = group.accent === 'blue'
                ? 'text-blue-500'
                : group.accent === 'purple'
                ? 'text-purple-500'
                : 'text-teal-500';
              return (
                <div
                  key={group.product}
                  className={`bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 ring-1 ${accentRing} p-7 flex flex-col`}
                >
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className={`text-5xl font-bold ${numberColor}`}>{group.count}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${accentBg}`}>
                      {group.badge}
                    </span>
                  </div>
                  <div className="text-base font-semibold text-gray-900 dark:text-white mb-1">{group.product}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-5">
                    {group.count} checks across {group.categories} categories
                  </div>
                  <ul className="space-y-2.5 mb-6 flex-1">
                    {group.examples.map((ex) => (
                      <li key={ex} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                        <CheckCircle className={`h-4 w-4 ${checkColor} flex-shrink-0 mt-0.5`} />
                        <span>{ex}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/checks"
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 mt-auto"
                  >
                    View all {group.count} {group.badge} checks
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="text-center mt-10">
            <Link
              href="/checks"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 transition-all"
            >
              View all {TOTAL_CHECKS} checks across {TOTAL_CATEGORIES} categories
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ WHY ORGPRISM ═══ */}
      <section className="py-24 bg-white dark:bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for Revenue Cloud Consultants</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Stop spending days manually reviewing Revenue Cloud configurations. OrgPrism does it in seconds.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Before */}
            <div className="bg-red-50 dark:bg-red-500/5 rounded-2xl border border-red-200 dark:border-red-500/20 p-8">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold mb-6">
                <AlertTriangle className="h-5 w-5" />
                Without OrgPrism
              </div>
              <ul className="space-y-4">
                {[
                  'Manual review takes 2-3 days per org',
                  'Easy to miss conflicting price rules',
                  'No standardized audit process',
                  'Reports created manually in PowerPoint',
                  'No historical comparison capability',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <span className="text-red-500 mt-0.5">&#10005;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* After */}
            <div className="bg-green-50 dark:bg-green-500/5 rounded-2xl border border-green-200 dark:border-green-500/20 p-8">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold mb-6">
                <CheckCircle className="h-5 w-5" />
                With OrgPrism
              </div>
              <ul className="space-y-4">
                {[
                  'Full audit in under 30 seconds',
                  '102 automated checks catch every issue',
                  'Consistent, repeatable audit process',
                  'Professional PDF reports in one click',
                  'Track health over time with scan history',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOUNDER NOTE (replaces fabricated testimonials) ═══
          Three first-name+last-initial testimonials at major consulting
          firms with no photos, no LinkedIn links, and no firm logos read
          as fabricated to anyone with consulting experience — actively
          harming trust on a page about trust. Replaced with an honest
          first-person founder note. Copy is content-v2 Variant A (the
          renewal opp bug war story). Bring back proper testimonials
          only once we have real ones with full name, photo, company,
          role, and a LinkedIn link per testimonial.
      ═══ */}
      <section className="py-24">
        <div className="max-w-2xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why I built OrgPrism</h2>
          </div>

          <div className="bg-gray-50/50 dark:bg-gray-900/30 rounded-2xl border border-gray-200 dark:border-gray-800 p-7 md:p-9">
            {/* Desktop: avatar left, copy right. Mobile: stacked. */}
            <div className="flex flex-col md:flex-row items-start gap-6 md:gap-7">
              <div className="flex md:flex-col items-center md:items-start gap-4 md:gap-3 md:flex-shrink-0 md:w-32">
                {/* Real founder photo at /maulik.png */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/maulik.png"
                  alt="Maulik Thakkar — founder of OrgPrism"
                  className="w-16 h-16 md:w-20 md:h-20 rounded-full flex-shrink-0 object-cover ring-2 ring-white dark:ring-gray-800 shadow-md"
                  loading="lazy"
                />
                <div className="md:mt-1">
                  <div className="font-semibold">Maulik</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    Salesforce CPQ practitioner
                    <br className="hidden md:inline" />
                    {' '}Vadodara, India
                  </div>
                  {/* TODO: add real LinkedIn URL */}
                  <a
                    href="#"
                    className="inline-block mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    LinkedIn &rarr;
                  </a>
                </div>
              </div>

              <div className="flex-1 text-gray-700 dark:text-gray-300 leading-relaxed text-[15px] space-y-4">
                <p>
                  A few months ago I was three days deep into a renewal opportunity bug. The customer&rsquo;s contracts had renewal forecast checked, the batch jobs were running, and yet no renewal opps were being created. I ran SOQL queries, checked CPQ batch configurations, traced through the standard objects, and still couldn&rsquo;t pin it down.
                </p>
                <p>
                  What struck me wasn&rsquo;t the bug itself &mdash; every CPQ implementer has lived through one of these. It was that I&rsquo;d seen variations of the same problem across three different orgs in the past year. The misconfiguration patterns were predictable. The detection should have been automated.
                </p>
                <p>
                  OrgPrism started as a weekend project to catch the configuration patterns I kept tripping over. Today it runs {TOTAL_CHECKS} checks across CPQ, Billing, and ARM in under 30 seconds &mdash; the audit I wish I&rsquo;d had the morning that bug ticket landed.
                </p>
                <p>
                  If you&rsquo;ve spent a week chasing a CPQ misconfiguration that turned out to be obvious in hindsight, this is for you.{' '}
                  {/* TODO: replace once orgprism.app is wired up — site is
                      currently served from orgprism.vercel.app while this
                      email points at a domain we don't control yet. */}
                  Reply directly to{' '}
                  <a
                    href="mailto:hello@orgprism.app"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    hello@orgprism.app
                  </a>
                  {' '}&mdash; comes straight to my inbox.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ PRICING ═══ */}
      <section id="pricing" className="py-24 bg-white dark:bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Start free. Upgrade when you need more.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free */}
            <div className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-8">
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Free</div>
              <div className="text-4xl font-bold mb-1">$0</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">forever</div>
              <ul className="space-y-3 mb-8">
                {['1 Salesforce org', '5 scans per month', 'CPQ checks only', 'Basic PDF report'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block text-center w-full py-2.5 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Connect a sandbox
              </Link>
            </div>

            {/* Pro */}
            <div className="bg-white dark:bg-gray-900/50 rounded-2xl border-2 border-blue-500 p-8 relative shadow-lg shadow-blue-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-brand-indigo text-white text-xs font-bold rounded-full">
                MOST POPULAR
              </div>
              <div className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-2">Pro</div>
              <div className="text-4xl font-bold mb-1">$49</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">per month</div>
              <ul className="space-y-3 mb-8">
                {['5 Salesforce orgs', 'Unlimited scans', 'CPQ + Billing + ARM checks', 'AI fix suggestions', 'PDF reports', 'Scheduled scans'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block text-center w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm shadow-blue-600/30"
              >
                Connect a sandbox
              </Link>
            </div>

            {/* Enterprise */}
            <div className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-8">
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Enterprise</div>
              <div className="text-4xl font-bold mb-1">Custom</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">talk to us</div>
              <ul className="space-y-3 mb-8">
                {['Unlimited orgs', 'Team access', 'White-label reports', 'Priority support', 'Custom integrations'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-purple-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {/* TODO: replace once orgprism.app is wired up — site is
                  currently served from orgprism.vercel.app while this
                  email points at a domain we don't control yet. */}
              <a
                href="mailto:hello@orgprism.app"
                className="block text-center w-full py-2.5 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FAQ (Task #9) ═══
          Accordion-style FAQ addresses common buyer objections that
          weren't handled anywhere on the page. Uses native
          <details>/<summary> for accessibility and zero-JS expansion. */}
      <section id="faq" className="py-24 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Frequently asked questions</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Common questions from consultants evaluating OrgPrism.
            </p>
          </div>
          <div className="space-y-3">
            {[
              {
                q: 'Is my Salesforce data stored?',
                a: 'No. OrgPrism reads metadata via OAuth at scan time only. Scan results (issue summaries, severity, affected record IDs) are stored encrypted in our database. We don\'t replicate your Salesforce records.',
              },
              {
                q: 'Do I need to install a managed package?',
                a: 'No. OrgPrism connects via standard OAuth and runs entirely against the Salesforce REST/SOAP APIs. Nothing is installed in your org.',
              },
              {
                q: 'Which Salesforce editions are supported?',
                a: 'Enterprise, Unlimited, and Developer editions with CPQ (SBQQ), Salesforce Billing (blng), and/or Revenue Cloud (RLM) features enabled.',
              },
              {
                q: 'Can I run this on a client\'s org?',
                a: 'Yes. The client grants OAuth access from their org — no admin elevation needed beyond the standard "Allow access" prompt. Read-only scope.',
              },
              {
                q: 'What happens when the OAuth token expires?',
                a: 'OrgPrism auto-refreshes tokens for you. If the user revokes access, we mark the org\'s connection as expired and the next scan will prompt re-authentication.',
              },
              {
                q: 'How is the AI fix suggestion generated?',
                a: 'We send anonymised configuration patterns (no record-level data, no field values) to Google Gemini and use the response to draft a remediation suggestion. The raw record data never leaves your tenant.',
              },
              {
                q: 'Can I export findings to Jira / Asana / CSV?',
                a: 'PDF and CSV export are available today. Jira and Asana integrations are on the roadmap — not shipped yet.',
              },
              {
                q: 'What\'s the cancellation policy?',
                a: 'Cancel any time from your account settings. Charges are prorated to the day of cancellation.',
              },
            ].map((item, i) => (
              <details
                key={i}
                className="group bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer list-none font-semibold text-gray-900 dark:text-white">
                  <span>{item.q}</span>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">&#x25BE;</span>
                </summary>
                <div className="px-6 pb-5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA (Task #11) ═══
          CTAs standardized to "Connect a sandbox" + "View sample report"
          across every position on the page. */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-3xl p-12 md:p-16 text-center text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-10 left-10 w-60 h-60 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-10 right-10 w-80 h-80 bg-blue-300 rounded-full blur-3xl" />
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to audit your first Revenue Cloud org?</h2>
              <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
                Connect a sandbox in 60 seconds. {TOTAL_CHECKS} health checks. AI fix suggestions. White-label reports.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-blue-700 bg-white hover:bg-blue-50 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 w-full sm:w-auto justify-center"
                >
                  Connect a sandbox
                  <ArrowRight className="h-5 w-5" />
                </Link>
                {/* TODO: replace with real PDF — generate one anonymized sample report and host at /sample-report.pdf */}
                <a
                  href="/sample-report.pdf"
                  className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-white/10 hover:bg-white/20 rounded-xl transition-all duration-200 border border-white/20 w-full sm:w-auto justify-center"
                >
                  View sample report
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER (Task #13) ═══
          Expanded from 3 inline links to a 4-column information architecture.
          Every link below routes to a page that resolves (TODO comments
          mark stubs we still need to build). Copyright reframed per
          Task #18 to remove the boilerplate-y "© 2026 OrgPrism" line. */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4 text-white">
                <LogoMark size={32} />
                <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white">OrgPrism</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                AI-driven config audits for Salesforce Revenue Cloud.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">Product</div>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li><a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-gray-900 dark:hover:text-white transition-colors">Pricing</a></li>
                {/* TODO: host real anonymised PDF */}
                <li><a href="/sample-report.pdf" className="hover:text-gray-900 dark:hover:text-white transition-colors">Sample report</a></li>
                <li><Link href="/changelog" className="hover:text-gray-900 dark:hover:text-white transition-colors">Changelog</Link></li>
                <li><Link href="/compare" className="hover:text-gray-900 dark:hover:text-white transition-colors">Compare</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">Company</div>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                {/* TODO: build /about page */}
                <li><Link href="/about" className="hover:text-gray-900 dark:hover:text-white transition-colors">About</Link></li>
                {/* TODO: replace with real domain once orgprism.app is wired up */}
                <li><a href="mailto:hello@orgprism.app" className="hover:text-gray-900 dark:hover:text-white transition-colors">Contact</a></li>
                <li><a href="#faq" className="hover:text-gray-900 dark:hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">Legal</div>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                {/* TODO: build /privacy /terms /security /dpa pages — required for Salesforce OAuth review */}
                <li><Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">Terms</Link></li>
                <li><Link href="/security" className="hover:text-gray-900 dark:hover:text-white transition-colors">Security</Link></li>
                <li><Link href="/dpa" className="hover:text-gray-900 dark:hover:text-white transition-colors">DPA</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold mb-3">Resources</div>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                {/* TODO: build /docs page */}
                <li><Link href="/docs" className="hover:text-gray-900 dark:hover:text-white transition-colors">Documentation</Link></li>
                {/* TODO: stand up real status page (UptimeRobot or similar) */}
                <li><Link href="/status" className="hover:text-gray-900 dark:hover:text-white transition-colors">Status</Link></li>
                <li><Link href="/login" className="hover:text-gray-900 dark:hover:text-white transition-colors">Sign in</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              &copy; OrgPrism. All rights reserved.
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Launched 2026 in Vadodara, India.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
