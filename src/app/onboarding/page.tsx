'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle,
  Cloud,
  Rocket,
  User,
  Building2,
  Lock,
  Loader2,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import type { OrgCardData } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface ScanResult {
  scanId: string;
  status: string;
  score?: number;
  orgId?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const ROLE_OPTIONS = [
  'Salesforce Admin',
  'Consultant',
  'Solution Architect',
  'RevOps Lead',
  'Developer',
  'Other',
];

const COMPANY_SIZE_OPTIONS = [
  'Solo',
  '2-10 employees',
  '11-50 employees',
  '50+ employees',
];

const REFERRAL_OPTIONS = [
  'Google Search',
  'LinkedIn',
  'Salesforce AppExchange',
  'Colleague Referral',
  'Twitter/X',
  'Other',
];

const STEP_LABELS = ['Profile', 'Connect', 'Scan'];

/* ------------------------------------------------------------------ */
/*  Shared class strings                                              */
/* ------------------------------------------------------------------ */

const inputClasses =
  'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors';

const selectClasses =
  'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors appearance-none';

const primaryBtnClasses =
  'inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm shadow-blue-600/30 hover:shadow-md hover:shadow-blue-600/40';

const skipLinkClasses =
  'text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer';

/* ------------------------------------------------------------------ */
/*  Step Indicator                                                    */
/* ------------------------------------------------------------------ */

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1;
        const isComplete = currentStep > stepNum;
        const isCurrent = currentStep === stepNum;

        return (
          <div key={label} className="flex items-center gap-3">
            {i > 0 && (
              <div
                className={`w-12 h-0.5 rounded-full transition-colors duration-300 ${
                  isComplete ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  isComplete
                    ? 'bg-blue-600 text-white'
                    : isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/40'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                }`}
              >
                {isComplete ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-sm font-medium hidden sm:inline transition-colors duration-300 ${
                  isCurrent
                    ? 'text-gray-900 dark:text-white'
                    : isComplete
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Score Ring (for scan result preview)                               */
/* ------------------------------------------------------------------ */

function ScoreRing({ score }: { score: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-gray-100 dark:text-gray-800"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">
          {score}
        </span>
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">
          Score
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Select wrapper (with chevron)                                     */
/* ------------------------------------------------------------------ */

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={selectClasses}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronRight className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 rotate-90" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                      */
/* ------------------------------------------------------------------ */

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [referralSource, setReferralSource] = useState('');

  // Step 2
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [connecting, setConnecting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [orgsLoaded, setOrgsLoaded] = useState(false);

  // Step 3
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');

  /* ---------- data loaders ---------- */

  const loadUserData = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.company_name) setCompanyName(data.company_name);
        if (data.role) setRole(data.role);
        if (data.company_size) setCompanySize(data.company_size);
        if (data.referral_source) setReferralSource(data.referral_source);
      }
    } catch {
      // silent
    }
  }, []);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await fetch('/api/orgs', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setOrgs(data);
      }
    } catch {
      // silent
    } finally {
      setOrgsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadUserData();
    loadOrgs();
  }, [loadUserData, loadOrgs]);

  // OAuth callback detection
  useEffect(() => {
    if (searchParams.get('success')) {
      setStep(2);
      loadOrgs();
    }
  }, [searchParams, loadOrgs]);

  /* ---------- handlers ---------- */

  function handleNextFromStep1() {
    setStep(2);
  }

  async function handleConnectOrg() {
    setConnecting(true);
    try {
      const res = await fetch('/api/salesforce/auth-url');
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setConnecting(false);
    }
  }

  async function handleRunScan() {
    if (orgs.length === 0) return;
    const org = orgs[0];
    setScanning(true);
    setScanError('');

    try {
      const packages = org.installed_packages || [];
      const hasCPQ = packages.includes('cpq');
      const hasBilling = packages.includes('billing');
      const productType =
        hasCPQ && hasBilling ? 'cpq_billing' : hasCPQ ? 'cpq' : 'cpq';

      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: org.id,
          productType,
        }),
      });
      const data = await res.json();

      if (res.status === 429) {
        setScanError(
          data.message ||
            'Scan limit reached. You can run scans from your dashboard later.'
        );
        setScanning(false);
        return;
      }

      if (!res.ok) {
        setScanError(data.error || 'Failed to start scan');
        setScanning(false);
        return;
      }

      const scanId = data.scanId;

      // Poll for completion
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
          const scan = await statusRes.json();
          if (scan.status === 'completed') {
            clearInterval(interval);
            setScanResult({
              scanId,
              status: 'completed',
              score: scan.overall_score ?? scan.score ?? 0,
              orgId: org.id,
            });
            setScanning(false);
          } else if (scan.status === 'failed') {
            clearInterval(interval);
            setScanError('Scan failed. You can retry from your dashboard.');
            setScanning(false);
          }
        } catch {
          // keep polling
        }
      }, 3000);
    } catch {
      setScanError('Something went wrong. You can scan from your dashboard.');
      setScanning(false);
    }
  }

  async function completeOnboarding(redirectTo?: string) {
    setSaving(true);
    try {
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName || undefined,
          role: role || undefined,
          company_size: companySize || undefined,
          referral_source: referralSource || undefined,
          onboarding_completed: true,
        }),
      });
    } catch {
      // continue anyway
    }

    document.cookie =
      'onboarding_completed=true; path=/; max-age=31536000; SameSite=Lax';
    setSaving(false);
    router.push(redirectTo || '/dashboard');
  }

  /* ---------- render ---------- */

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Top bar */}
      <header className="w-full px-6 py-5 flex items-center justify-between">
        <Logo size="md" />
        <button
          onClick={() => completeOnboarding()}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Skip setup
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-12 pt-4 sm:pt-0">
        <div className="w-full max-w-lg">
          {/* Step indicator */}
          <div className="mb-8">
            <StepIndicator currentStep={step} />
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-black/30 border border-gray-100 dark:border-gray-800 p-8 transition-all duration-300">
            {/* ============== STEP 1 ============== */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center mb-2">
                  <div className="inline-flex p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl mb-4">
                    <User className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Welcome to ConfigCheck!{' '}
                    <span role="img" aria-label="wave">
                      &#x1F44B;
                    </span>
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Let&apos;s set up your account in under 2 minutes
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Company name{' '}
                    <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className={inputClasses}
                    placeholder="Your consulting firm or company"
                  />
                </div>

                <SelectField
                  label="Your role"
                  value={role}
                  onChange={setRole}
                  options={ROLE_OPTIONS}
                  placeholder="Select your role..."
                />

                <SelectField
                  label="Company size"
                  value={companySize}
                  onChange={setCompanySize}
                  options={COMPANY_SIZE_OPTIONS}
                  placeholder="Select company size..."
                />

                <SelectField
                  label="How did you hear about us?"
                  value={referralSource}
                  onChange={setReferralSource}
                  options={REFERRAL_OPTIONS}
                  placeholder="Select one..."
                />

                <button
                  onClick={handleNextFromStep1}
                  disabled={!companyName.trim()}
                  className={`${primaryBtnClasses} w-full`}
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* ============== STEP 2 ============== */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="text-center mb-2">
                  <div className="inline-flex p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl mb-4">
                    <Cloud className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Connect Your Salesforce Org
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    We use OAuth 2.0 &mdash; your credentials are never stored
                    on our servers
                  </p>
                </div>

                {/* Connected orgs */}
                {orgs.length > 0 ? (
                  <div className="space-y-3">
                    {orgs.map((org) => (
                      <div
                        key={org.id}
                        className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
                      >
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-green-800 dark:text-green-300 truncate">
                            {org.name}
                          </p>
                          <p className="text-xs text-green-600 dark:text-green-500">
                            {org.is_sandbox ? 'Sandbox' : 'Production'} &middot;
                            Connected
                          </p>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={() => setStep(3)}
                      className={`${primaryBtnClasses} w-full mt-4`}
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Connect button */}
                    <button
                      onClick={handleConnectOrg}
                      disabled={connecting}
                      className={`${primaryBtnClasses} w-full py-4 text-base`}
                    >
                      {connecting ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Cloud className="h-5 w-5" />
                          Connect Salesforce Org
                        </>
                      )}
                    </button>

                    <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                      Works with both Production and Sandbox orgs
                    </p>

                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <Lock className="h-3.5 w-3.5" />
                      <span>
                        Read-only access &middot; Your data stays in Salesforce
                      </span>
                    </div>
                  </div>
                )}

                {/* Skip */}
                <div className="text-center pt-2">
                  <button
                    onClick={() => setStep(3)}
                    className={skipLinkClasses}
                  >
                    Skip for now &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* ============== STEP 3 ============== */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="text-center mb-2">
                  <div className="inline-flex p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl mb-4">
                    <BarChart3 className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Run Your First Health Check
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    See how healthy your Salesforce configuration is
                  </p>
                </div>

                {/* No org connected */}
                {orgs.length === 0 && !scanning && !scanResult && (
                  <div className="text-center py-6">
                    <div className="inline-flex p-3 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
                      <Cloud className="h-7 w-7 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                      Connect an org from your dashboard to run your first scan
                    </p>
                    <button
                      onClick={() => completeOnboarding('/dashboard')}
                      disabled={saving}
                      className={`${primaryBtnClasses}`}
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          Go to Dashboard
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Org connected, ready to scan */}
                {orgs.length > 0 && !scanning && !scanResult && (
                  <div className="space-y-5">
                    {/* Org summary */}
                    {orgs.map((org) => (
                      <div
                        key={org.id}
                        className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
                      >
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-green-800 dark:text-green-300 truncate">
                          {org.name}
                        </span>
                      </div>
                    ))}

                    <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                      This typically takes 30&ndash;60 seconds
                    </p>

                    {scanError && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                        {scanError}
                      </div>
                    )}

                    <button
                      onClick={handleRunScan}
                      className={`${primaryBtnClasses} w-full py-4 text-base`}
                    >
                      <Rocket className="h-5 w-5" />
                      Run First Scan
                    </button>
                  </div>
                )}

                {/* Scanning */}
                {scanning && (
                  <div className="text-center py-8">
                    <div className="relative mx-auto w-20 h-20 mb-6">
                      <div className="absolute inset-0 rounded-full border-4 border-gray-100 dark:border-gray-800" />
                      <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Building2 className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                      Scanning your org...
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Analyzing Revenue Cloud configuration and rules
                    </p>
                  </div>
                )}

                {/* Scan complete */}
                {scanResult && scanResult.status === 'completed' && (
                  <div className="text-center py-4 space-y-5">
                    <ScoreRing score={scanResult.score ?? 0} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        Health Check Complete!
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Your org scored{' '}
                        <span className="font-bold">
                          {scanResult.score}/100
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        completeOnboarding(`/orgs/${scanResult.orgId}`)
                      }
                      disabled={saving}
                      className={`${primaryBtnClasses} w-full`}
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          View Results
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Skip */}
                {!scanning && (
                  <div className="text-center pt-2">
                    <button
                      onClick={() => completeOnboarding()}
                      disabled={saving}
                      className={skipLinkClasses}
                    >
                      {saving ? 'Saving...' : "Skip \u2014 I'll scan later \u2192"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Back button for steps 2 & 3 */}
          {step > 1 && !scanning && (
            <button
              onClick={() => setStep(step - 1)}
              className="mt-4 mx-auto block text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              &larr; Back
            </button>
          )}

          <p className="text-xs text-gray-400 text-center mt-6">
            Built for Salesforce Revenue Cloud consulting firms
          </p>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export with Suspense boundary (required for useSearchParams) */
/* ------------------------------------------------------------------ */

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
