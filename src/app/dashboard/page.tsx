'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, CheckCircle, AlertCircle, Cloud, GitCompare, RefreshCw } from 'lucide-react';
import { OrgCard } from '@/components/dashboard/org-card';
import { DisconnectedOrgs } from '@/components/dashboard/disconnected-orgs';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import type { ChecklistProgress } from '@/components/dashboard/onboarding-checklist';
import { ConnectOrgModal } from '@/components/dashboard/connect-org-modal';
import { LoadingScreen } from '@/components/ui/loading-screen';
import type { OrgCardData } from '@/types';

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [orgsRefreshKey, setOrgsRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanningOrg, setScanningOrg] = useState<string | null>(null);
  // Scan-all progress: tracks the running batch so we can show a banner
  // and disable the trigger while it's in flight.
  const [scanAllProgress, setScanAllProgress] = useState<{
    current: number;
    total: number;
    currentOrgName: string;
  } | null>(null);
  const [checklistProgress, setChecklistProgress] = useState<ChecklistProgress | null>(null);
  const [checklistDismissed, setChecklistDismissed] = useState(true); // default hidden
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const successMsg = searchParams.get('success');
  const errorMsg = searchParams.get('error');
  // Workspace-switch confirmation banner — set by TeamSwitcher when the user
  // changes context. Dismissable; auto-clears the query param so it doesn't
  // re-appear on refresh.
  const switchedLabel = searchParams.get('switched');
  const [switchedDismissed, setSwitchedDismissed] = useState(false);
  const [flashDismissed, setFlashDismissed] = useState(false);

  // Auto-clear OAuth success/error params from the URL after they're shown
  // once, so a page refresh doesn't re-surface a stale message.
  useEffect(() => {
    if (!successMsg && !errorMsg) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }, 100);
    return () => clearTimeout(t);
  }, [successMsg, errorMsg]);

  function dismissFlash() {
    setFlashDismissed(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('success');
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }

  // Refetch orgs on mount AND when page becomes visible/focused again
  // (Next.js client-side router cache can serve stale data on back-navigation)
  useEffect(() => {
    fetchOrgs();
    fetchUserData();

    const refetchOnVisible = () => {
      if (document.visibilityState === 'visible') fetchOrgs();
    };
    const refetchOnFocus = () => fetchOrgs();
    document.addEventListener('visibilitychange', refetchOnVisible);
    window.addEventListener('focus', refetchOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', refetchOnVisible);
      window.removeEventListener('focus', refetchOnFocus);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  async function fetchUserData() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.onboarding_completed && !data.checklist_dismissed) {
          setChecklistDismissed(false);
          const progress: ChecklistProgress = data.checklist_progress || {
            profile_completed: !!(data.company_name && data.job_title),
            org_connected: false,
            first_scan_run: false,
            issue_reviewed: false,
            pdf_generated: false,
            schedule_created: false,
          };
          setChecklistProgress(progress);
        }
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  }

  async function fetchOrgs() {
    try {
      const res = await fetch('/api/orgs', { cache: 'no-store' });
      if (res.ok) {
        const data: OrgCardData[] = await res.json();
        setOrgs(data);
        setOrgsRefreshKey((k) => k + 1);

        // Backfill: any connected org with no detected packages gets a
        // background detection run, so the next "Run Scan" click picks the
        // right product type. Fire-and-forget — we don't block render on it.
        for (const o of data) {
          if (
            (!o.installed_packages || o.installed_packages.length === 0) &&
            (o.connection_status === 'connected' || !o.connection_status)
          ) {
            fetch('/api/orgs/detect-packages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ organizationId: o.id }),
            }).catch((err) => console.error('Background detection failed:', err));
          }
        }
        // After orgs are loaded, update org_connected and first_scan_run
        setChecklistProgress((prev) => {
          if (!prev || data.length === 0) return prev;
          const updated = { ...prev, org_connected: true };
          if (data.some((o: OrgCardData) => o.last_scan_at)) updated.first_scan_run = true;
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to fetch orgs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismissChecklist() {
    setChecklistDismissed(true);
    await fetch('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklist_dismissed: true }),
    });
  }

  function handleConnectOrg() {
    setConnectModalOpen(true);
  }

  // Pick the best product type for an org based on installed packages,
  // running detection if it hasn't been done. Shared by handleScan and
  // handleScanAll so we don't duplicate the priority logic.
  async function pickProductType(orgId: string): Promise<'cpq' | 'cpq_billing' | 'arm'> {
    const org = orgs.find((o) => o.id === orgId);
    let packages = org?.installed_packages || [];
    if (packages.length === 0) {
      try {
        const detectRes = await fetch('/api/orgs/detect-packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: orgId }),
        });
        if (detectRes.ok) {
          const detectData = await detectRes.json();
          packages = detectData.packages || [];
        }
      } catch (err) {
        console.error('Package detection failed before scan:', err);
      }
    }
    const hasCPQ = packages.includes('cpq');
    const hasBilling = packages.includes('billing');
    const hasARM = packages.includes('arm');
    if (hasCPQ && hasBilling) return 'cpq_billing';
    if (hasCPQ) return 'cpq';
    if (hasARM) return 'arm';
    return 'cpq';
  }

  // Trigger a scan and resolve when it reaches a terminal state (completed
  // or failed). Returns null if the trigger itself failed (e.g. quota 429
  // — message already shown to user).
  async function runScanAndWait(
    orgId: string,
    productType: 'cpq' | 'cpq_billing' | 'arm',
  ): Promise<{ status: 'completed' | 'failed'; scanId: string } | null> {
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId, productType }),
    });
    const data = await res.json();
    if (res.status === 429) {
      alert(data.message || 'You have reached your scan limit. Please upgrade to continue.');
      return null;
    }
    if (!res.ok) {
      console.error('Scan trigger failed:', data);
      return null;
    }
    const scanId: string = data.scanId;
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
          const scan = await statusRes.json();
          if (scan.status === 'completed' || scan.status === 'failed') {
            clearInterval(interval);
            resolve({ status: scan.status, scanId });
          }
        } catch (err) {
          console.error('Scan poll failed:', err);
        }
      }, 3000);
    });
  }

  async function handleScanAll() {
    const targets = orgs.filter((o) => (o.connection_status === 'connected' || !o.connection_status));
    if (targets.length === 0) return;
    if (!confirm(`Scan all ${targets.length} org${targets.length !== 1 ? 's' : ''} sequentially? This may take several minutes.`)) {
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      const o = targets[i];
      setScanAllProgress({ current: i + 1, total: targets.length, currentOrgName: o.name });
      setScanningOrg(o.id);
      try {
        const productType = await pickProductType(o.id);
        const result = await runScanAndWait(o.id, productType);
        if (!result) {
          // Quota or trigger failure — abort the rest of the batch.
          break;
        }
      } finally {
        setScanningOrg(null);
      }
    }
    setScanAllProgress(null);
    await fetchOrgs();
  }

  async function handleScan(orgId: string) {
    setScanningOrg(orgId);
    try {
      // Determine the best scan type from installed packages.
      // If packages haven't been detected yet (e.g. org connected before detection
      // was wired in, or detection failed), trigger detection once now and use
      // the fresh result.
      const org = orgs.find((o) => o.id === orgId);
      let packages = org?.installed_packages || [];
      if (packages.length === 0) {
        try {
          const detectRes = await fetch('/api/orgs/detect-packages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId: orgId }),
          });
          if (detectRes.ok) {
            const detectData = await detectRes.json();
            packages = detectData.packages || [];
          }
        } catch (err) {
          console.error('Package detection failed before scan:', err);
        }
      }
      const hasCPQ = packages.includes('cpq');
      const hasBilling = packages.includes('billing');
      const hasARM = packages.includes('arm');
      // Priority: CPQ+Billing > CPQ-only > ARM > fallback CPQ
      // (ARM is lower priority because if both CPQ and ARM are present we
      // assume CPQ is the primary configured product. Users wanting an ARM
      // scan can pick it explicitly from the org detail page.)
      let productType: 'cpq' | 'cpq_billing' | 'arm';
      if (hasCPQ && hasBilling) productType = 'cpq_billing';
      else if (hasCPQ) productType = 'cpq';
      else if (hasARM) productType = 'arm';
      else productType = 'cpq';

      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, productType }),
      });
      const data = await res.json();

      // Handle quota limit
      if (res.status === 429) {
        setScanningOrg(null);
        alert(data.message || 'You have reached your scan limit. Please upgrade to continue.');
        return;
      }
      const scanId = data.scanId;

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(async () => {
        const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
        const scan = await statusRes.json();
        if (scan.status === 'completed' || scan.status === 'failed') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setScanningOrg(null);
          // Refresh org data first so dashboard has fresh state when user navigates back
          await fetchOrgs();
          if (scan.status === 'completed') {
            router.push(`/orgs/${orgId}`);
          }
        }
      }, 3000);
    } catch (error) {
      console.error('Failed to start scan:', error);
      setScanningOrg(null);
    }
  }

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div>
      <ConnectOrgModal isOpen={connectModalOpen} onClose={() => setConnectModalOpen(false)} />

      {/* Workspace-switch confirmation banner */}
      {switchedLabel && !switchedDismissed && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50 rounded-xl animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center flex-shrink-0">
            <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-300">
              You&apos;re now viewing <span className="font-bold">{switchedLabel}</span>
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              {orgs.length} org{orgs.length !== 1 ? 's' : ''} visible in this workspace
            </p>
          </div>
          <button
            onClick={() => {
              setSwitchedDismissed(true);
              // Clear the query param so a refresh doesn't re-show the banner
              const url = new URL(window.location.href);
              url.searchParams.delete('switched');
              window.history.replaceState({}, '', url.toString());
            }}
            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition flex-shrink-0"
            aria-label="Dismiss"
          >
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        </div>
      )}

      {/* Success/Error Messages — dismissable, and the query param is
          cleared on dismiss so a refresh doesn't re-surface a stale
          message (especially OAuth callback errors that linger in the URL). */}
      {successMsg && !flashDismissed && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl animate-in fade-in">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-green-800 flex-1">{successMsg}</p>
          <button
            onClick={dismissFlash}
            className="p-1 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-lg transition flex-shrink-0"
            aria-label="Dismiss"
          >
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        </div>
      )}
      {errorMsg && !flashDismissed && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-800 flex-1 break-words">{errorMsg}</p>
          <button
            onClick={dismissFlash}
            className="p-1 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition flex-shrink-0"
            aria-label="Dismiss"
          >
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        </div>
      )}

      {checklistProgress && !checklistDismissed && (
        <OnboardingChecklist
          progress={checklistProgress}
          dismissed={checklistDismissed}
          onDismiss={handleDismissChecklist}
          onConnectOrg={handleConnectOrg}
          firstOrgId={orgs.length > 0 ? orgs[0].id : undefined}
        />
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your Organizations</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Connect Salesforce orgs to scan their Revenue Cloud configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {orgs.length >= 1 && (
            <button
              onClick={handleScanAll}
              disabled={!!scanAllProgress || !!scanningOrg}
              title="Scan every connected org one after another"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${scanAllProgress ? 'animate-spin' : ''}`} />
              {scanAllProgress ? `Scanning ${scanAllProgress.current}/${scanAllProgress.total}…` : 'Scan all'}
            </button>
          )}
          {orgs.length >= 2 && (
            <button
              onClick={() => router.push('/compare-orgs')}
              title="Diff config between any two connected orgs (sandbox ↔ sandbox, sandbox ↔ production, etc.)"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition"
            >
              <GitCompare className="w-4 h-4" />
              Compare two orgs
            </button>
          )}
        </div>
      </div>

      {scanAllProgress && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl">
          <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
              Scanning {scanAllProgress.current} of {scanAllProgress.total} — <span className="font-mono">{scanAllProgress.currentOrgName}</span>
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              Each org runs end-to-end before the next starts. Leave this page open until the batch finishes.
            </p>
          </div>
        </div>
      )}

      {orgs.length === 0 ? (
        // First-time empty state — educational, not just an empty canvas.
        // Per content-v2 dashboard audit: empty state should teach users
        // what's about to happen, not present them with a blank screen.
        <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50/50 dark:from-blue-950/30 dark:via-gray-900/40 dark:to-indigo-950/20 rounded-3xl border border-blue-100 dark:border-blue-900/40 p-8 md:p-12 text-center">
          <div className="inline-flex p-4 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 mb-5">
            <Cloud className="h-9 w-9 text-blue-500 dark:text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Connect your first Salesforce org
          </h3>
          <p className="text-gray-600 dark:text-gray-400 max-w-lg mx-auto mb-8 leading-relaxed">
            Get a complete CPQ + Billing + ARM health audit in under 30 seconds. Read-only OAuth — your data stays in Salesforce.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-10 text-left">
            {[
              {
                step: '1',
                title: 'Authorize via OAuth',
                desc: 'Read-only consent screen — takes 60 seconds. No managed package, no admin elevation.',
              },
              {
                step: '2',
                title: 'Run a health scan',
                desc: 'We probe 176 checks across 41 categories: price rules, bundles, approvals, billing, ARM and more.',
              },
              {
                step: '3',
                title: 'Review findings + fix',
                desc: 'Severity-coloured issue list, AI fix suggestions, and a white-label PDF export ready in seconds.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800 p-4"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-sm font-bold flex items-center justify-center mb-2">
                  {s.step}
                </div>
                <div className="font-semibold text-sm text-gray-900 dark:text-white mb-1">{s.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{s.desc}</div>
              </div>
            ))}
          </div>

          <button
            onClick={handleConnectOrg}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 hover:-translate-y-0.5"
          >
            <Plus className="h-5 w-5" />
            Connect a sandbox
          </button>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">&#128274; Read-only OAuth</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#128202; Metadata only</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#128230; No managed package</span>
            <span className="hidden sm:inline text-gray-300 dark:text-gray-700">&middot;</span>
            <span className="flex items-center gap-1.5">&#10060; Disconnect anytime</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {orgs.map((org) => (
            <OrgCard
              key={org.id}
              org={org}
              onView={() => router.push(`/orgs/${org.id}`)}
              onScan={() => handleScan(org.id)}
              onDisconnect={() => fetchOrgs()}
              scanning={scanningOrg === org.id}
            />
          ))}

          {/* Connect New Org Card */}
          <button
            onClick={handleConnectOrg}
            className="group relative border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center min-h-[220px] transition-all duration-300 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 hover:shadow-lg hover:shadow-blue-100/50 cursor-pointer"
          >
            <div className="p-3 bg-gray-100 dark:bg-gray-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 rounded-xl transition-colors duration-300 mb-3">
              <Plus className="h-6 w-6 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
            </div>
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
              Connect another sandbox
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
              <Cloud className="h-3 w-3" />
              OAuth login required
            </p>
          </button>
        </div>
      )}

      <DisconnectedOrgs onReconnect={() => fetchOrgs()} onForget={() => fetchOrgs()} refreshKey={orgsRefreshKey} />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-64" />}>
      <DashboardContent />
    </Suspense>
  );
}
