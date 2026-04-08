'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, CheckCircle, AlertCircle, Cloud } from 'lucide-react';
import { OrgCard } from '@/components/dashboard/org-card';
import type { OrgCardData } from '@/types';

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningOrg, setScanningOrg] = useState<string | null>(null);

  const successMsg = searchParams.get('success');
  const errorMsg = searchParams.get('error');

  useEffect(() => {
    fetchOrgs();
  }, []);

  async function fetchOrgs() {
    try {
      const res = await fetch('/api/orgs');
      if (res.ok) {
        const data = await res.json();
        setOrgs(data);
      }
    } catch (error) {
      console.error('Failed to fetch orgs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectOrg() {
    try {
      const res = await fetch('/api/salesforce/auth-url');
      const { url } = await res.json();
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get auth URL:', error);
    }
  }

  async function handleScan(orgId: string) {
    setScanningOrg(orgId);
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const { scanId } = await res.json();

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
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 bg-white rounded-2xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
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

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Your Organizations</h1>
        <p className="text-gray-500 mt-1">
          Connect Salesforce orgs to scan their CPQ configuration
        </p>
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
          className="group relative border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-2xl flex flex-col items-center justify-center min-h-[220px] transition-all duration-300 hover:bg-blue-50/50 hover:shadow-lg hover:shadow-blue-100/50 cursor-pointer"
        >
          <div className="p-3 bg-gray-100 group-hover:bg-blue-100 rounded-xl transition-colors duration-300 mb-3">
            <Plus className="h-6 w-6 text-gray-400 group-hover:text-blue-600 transition-colors" />
          </div>
          <p className="text-sm font-semibold text-gray-600 group-hover:text-blue-700 transition-colors">
            Connect Salesforce Org
          </p>
          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
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
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No orgs connected yet</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
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
