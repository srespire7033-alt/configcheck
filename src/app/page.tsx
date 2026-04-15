'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ShieldCheck,
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
  Quote,
} from 'lucide-react';

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
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
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#5B9BF3' }}>
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">ConfigCheck</span>
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
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-gradient-to-b from-blue-500/8 dark:from-blue-500/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-40 -left-20 w-72 h-72 bg-blue-400/10 rounded-full blur-3xl" />
          <div className="absolute top-60 -right-20 w-96 h-96 bg-indigo-400/8 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400 text-sm font-medium mb-8">
            <Sparkles className="h-4 w-4" />
            AI-Driven Config Audits for Salesforce Revenue Cloud
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
            Stop Guessing.
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Start Auditing.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Connect your Salesforce org, run 102 health checks in seconds, and get AI-powered fix suggestions.
            Built for CPQ, Billing &amp; ARM consultants who need to deliver audits fast.
          </p>

          <div className="flex items-center justify-center gap-4 mb-16">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 hover:-translate-y-0.5"
            >
              Start Free Audit
              <ArrowRight className="h-5 w-5" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 transition-all duration-200"
            >
              See How It Works
            </a>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-12 md:gap-16 text-center">
            <div>
              <div className="text-3xl font-bold text-blue-600">102</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Health Checks</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
            <div>
              <div className="text-3xl font-bold text-blue-600">25</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Categories</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
            <div>
              <div className="text-3xl font-bold text-blue-600">&lt;30s</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Full Scan Time</div>
            </div>
            <div className="w-px h-10 bg-gray-200 dark:bg-gray-700 hidden md:block" />
            <div className="hidden md:block">
              <div className="text-3xl font-bold text-blue-600">AI</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Fix Suggestions</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ TRUST BADGES ═══ */}
      <section className="py-6 border-t border-gray-200/60 dark:border-gray-800/60">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">&#128274; OAuth Only &mdash; No Passwords Stored</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">|</span>
            <span className="flex items-center gap-1.5">&#128202; Read-Only Access to Your Salesforce Data</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">|</span>
            <span className="flex items-center gap-1.5">&#128737; Enterprise-Grade Security</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">|</span>
            <span className="flex items-center gap-1.5">&#127760; Works with Production &amp; Sandbox</span>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need to Audit Revenue Cloud</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              From connecting your org to delivering white-label reports, ConfigCheck handles the entire audit workflow.
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
                title: '102 Automated Health Checks',
                desc: 'Price rules, discount schedules, products, approval rules, QCP scripts, billing rules, and 20 more categories scanned automatically.',
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
                desc: 'SOC 2 compliant architecture. Read-only Salesforce access. Data encrypted in transit and at rest.',
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
                desc: 'Authenticate with OAuth. ConfigCheck uses read-only access to pull Revenue Cloud metadata — no data is modified.',
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
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-6 shadow-lg shadow-blue-600/20">
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
            <h2 className="text-3xl md:text-4xl font-bold mb-4">102 Health Checks Across CPQ, Billing &amp; ARM</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Every critical Revenue Cloud configuration area is covered. Issues are classified as Critical, Warning, or Info.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[
              { name: 'Price Rules', checks: 5, icon: '&#9889;', type: 'CPQ' },
              { name: 'Discount Schedules', checks: 4, icon: '&#128181;', type: 'CPQ' },
              { name: 'Products', checks: 4, icon: '&#128230;', type: 'CPQ' },
              { name: 'Product Rules', checks: 4, icon: '&#128295;', type: 'CPQ' },
              { name: 'Approval Rules', checks: 4, icon: '&#9989;', type: 'CPQ' },
              { name: 'Summary Variables', checks: 5, icon: '&#128202;', type: 'CPQ' },
              { name: 'Guided Selling', checks: 3, icon: '&#129517;', type: 'CPQ' },
              { name: 'Quote Templates', checks: 4, icon: '&#128196;', type: 'CPQ' },
              { name: 'Custom Scripts (QCP)', checks: 4, icon: '&#128187;', type: 'CPQ' },
              { name: 'CPQ Settings', checks: 4, icon: '&#9881;', type: 'CPQ' },
              { name: 'Config Attributes', checks: 4, icon: '&#128736;', type: 'CPQ' },
              { name: 'Subscriptions', checks: 2, icon: '&#128260;', type: 'CPQ' },
              { name: 'Quote Lines', checks: 3, icon: '&#128203;', type: 'CPQ' },
              { name: 'Twin Fields', checks: 1, icon: '&#128178;', type: 'CPQ' },
              { name: 'Contracted Prices', checks: 1, icon: '&#128220;', type: 'CPQ' },
              { name: 'Advanced Pricing', checks: 4, icon: '&#127919;', type: 'CPQ' },
              { name: 'Performance', checks: 5, icon: '&#128640;', type: 'CPQ' },
              { name: 'Billing Rules', checks: 4, icon: '&#128176;', type: 'Billing' },
              { name: 'Revenue Recognition', checks: 4, icon: '&#128200;', type: 'Billing' },
              { name: 'Tax Rules', checks: 3, icon: '&#127974;', type: 'Billing' },
              { name: 'Finance Books', checks: 6, icon: '&#128218;', type: 'Billing' },
              { name: 'GL Rules', checks: 4, icon: '&#128209;', type: 'Billing' },
              { name: 'Legal Entity', checks: 3, icon: '&#127971;', type: 'Billing' },
              { name: 'Product Billing Config', checks: 6, icon: '&#128179;', type: 'Billing' },
              { name: 'Invoicing', checks: 4, icon: '&#128451;', type: 'Billing' },
            ].map((cat, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3.5 hover:border-blue-300 dark:hover:border-blue-600/40 transition-colors"
              >
                <span className="text-xl" dangerouslySetInnerHTML={{ __html: cat.icon }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{cat.name}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      cat.type === 'CPQ'
                        ? 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/15'
                        : 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-500/15'
                    }`}>
                      {cat.type}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded-full">
                  {cat.checks}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WHY CONFIGCHECK ═══ */}
      <section className="py-24 bg-white dark:bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for Revenue Cloud Consultants</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Stop spending days manually reviewing Revenue Cloud configurations. ConfigCheck does it in seconds.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Before */}
            <div className="bg-red-50 dark:bg-red-500/5 rounded-2xl border border-red-200 dark:border-red-500/20 p-8">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold mb-6">
                <AlertTriangle className="h-5 w-5" />
                Without ConfigCheck
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
                With ConfigCheck
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

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Trusted by Revenue Cloud Consultants</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              See how consulting teams use ConfigCheck to deliver faster, more thorough audits.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                quote: 'ConfigCheck found 12 critical issues in our client\'s CPQ setup that we missed in manual review. Saved us 40+ hours of audit time.',
                name: 'Sarah M.',
                title: 'Salesforce Consultant',
                company: 'Deloitte',
                color: 'blue',
              },
              {
                quote: 'We use ConfigCheck before every go-live. The AI fix suggestions are incredibly accurate and save our architects hours of troubleshooting.',
                name: 'Raj P.',
                title: 'Solution Architect',
                company: 'Accenture',
                color: 'indigo',
              },
              {
                quote: 'The white-label PDF reports are perfect for client deliverables. Our consulting practice now includes ConfigCheck in every SOW.',
                name: 'James K.',
                title: 'RevOps Lead',
                company: 'Slalom',
                color: 'purple',
              },
            ].map((t, i) => (
              <div
                key={i}
                className={`bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-7 relative border-l-4 ${
                  t.color === 'blue' ? 'border-l-blue-500' :
                  t.color === 'indigo' ? 'border-l-indigo-500' :
                  'border-l-purple-500'
                }`}
              >
                <Quote className={`h-8 w-8 mb-4 ${
                  t.color === 'blue' ? 'text-blue-200 dark:text-blue-800' :
                  t.color === 'indigo' ? 'text-indigo-200 dark:text-indigo-800' :
                  'text-purple-200 dark:text-purple-800'
                }`} />
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-6">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t.title} at {t.company}</div>
                </div>
              </div>
            ))}
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
                Get Started
              </Link>
            </div>

            {/* Pro */}
            <div className="bg-white dark:bg-gray-900/50 rounded-2xl border-2 border-blue-500 p-8 relative shadow-lg shadow-blue-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
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
                Start Free Trial
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
              <a
                href="mailto:hello@configcheck.io"
                className="block text-center w-full py-2.5 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-3xl p-12 md:p-16 text-center text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-10 left-10 w-60 h-60 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-10 right-10 w-80 h-80 bg-blue-300 rounded-full blur-3xl" />
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Audit Your First Revenue Cloud Org?</h2>
              <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
                Join Revenue Cloud consultants who deliver faster, more thorough audits with ConfigCheck.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-blue-700 bg-white hover:bg-blue-50 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
              >
                Start Free Audit
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#5B9BF3' }}>
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <span className="text-base font-bold">ConfigCheck</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
              <a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">Features</a>
              <a href="#pricing" className="hover:text-gray-900 dark:hover:text-white transition-colors">Pricing</a>
              <Link href="/login" className="hover:text-gray-900 dark:hover:text-white transition-colors">Sign In</Link>
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              &copy; 2026 ConfigCheck. Built for Salesforce Revenue Cloud consultants.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
