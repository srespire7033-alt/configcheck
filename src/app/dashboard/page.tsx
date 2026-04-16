'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, CheckCircle, AlertCircle, Cloud, GitCompare } from 'lucide-react';
import { OrgCard } from '@/components/dashboard/org-card';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import type { ChecklistProgress } from '@/components/dashboard/onboarding-checklist';
import { ConnectOrgModal } from '@/components/dashboard/connect-org-modal';
import { LoadingScreen } from '@/components/ui/loading-screen';
import type { OrgCardData } from '@/types';

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningOrg, setScanningOrg] = useState<string | null>(null);
  const [checklistProgress, setChecklistProgress] = useState<ChecklistProgress | null>(null);
  const [checklistDismissed, setChecklistDismissed] = useState(true); // default hidden
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const successMsg = searchParams.get('success');
  const errorMsg = searchParams.get('error');

  // Refetch orgs on mount AND when page becomes visible again
  // (Next.js client-side router cache can serve stale data on back-navigation)
  useEffect(() => {
    fetchOrgs();
    fetchUserData();

    const refetch = () => {
      if (document.visibilityState === 'visible') fetchOrgs();
    };
    document.addEventListener('visibilitychange', refetch);
    return () => document.removeEventListener('visibilitychange', refetch);
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
        const data = await res.json();
        setOrgs(data);
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

  async function handleScan(orgId: string) {
    setScanningOrg(orgId);
    try {
      // Determine the best scan type from installed packages
      const org = orgs.find((o) => o.id === orgId);
      const packages = org?.installed_packages || [];
      const hasCPQ = packages.includes('cpq');
      const hasBilling = packages.includes('billing');
      const productType = hasCPQ && hasBilling ? 'cpq_billing' : hasCPQ ? 'cpq' : 'cpq';

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

      const interval = setInterval(async () => {
        const statusRes = await fetch(`/api/scans?scanId=${scanId}`);
        const scan = await statusRes.json();
        if (scan.status === 'completed' || scan.status === 'failed') {
          clearInterval(interval);
          setScanningOrg(null);
          if (scan.status === 'completed') {
            router.push(`/orgs/${orgId}`);
          }
          fetchOrgs();
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

      {/* Success/Error Messages */}
      {successMsg && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl animate-in fade-in">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          <p className="text-sm font-medium text-green-800">{successMsg}</p>
        </div>
      )}
      {errorMsg && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm font-medium text-red-800">{errorMsg}</p>
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
        {orgs.length >= 2 && (
          <button
            onClick={() => router.push('/compare-orgs')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-100 transition"
          >
            <GitCompare className="w-4 h-4" />
            Sandbox vs Production
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {orgs.map((org) => (
          <OrgCard
            key={org.id}
            org={org}
            onView={() => router.push(`/orgs/${org.id}`)}
            onScan={() => handleScan(org.id)}
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
            Connect Salesforce Org
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
            <Cloud className="h-3 w-3" />
            OAuth login required
          </p>
        </button>
      </div>

      {orgs.length === 0 && (
        <div className="text-center mt-12">
          <div className="inline-flex p-4 bg-blue-50 rounded-2xl mb-4">
            <Cloud className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No orgs connected yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Click &quot;Connect Salesforce Org&quot; above to link your first org and run a health scan.
          </p>
        </div>
      )}
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
