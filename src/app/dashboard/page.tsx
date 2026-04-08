'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { OrgCard } from '@/components/dashboard/org-card';
import { Card, CardContent } from '@/components/ui/card';
import type { OrgCardData } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningOrg, setScanningOrg] = useState<string | null>(null);

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

      // Poll for completion
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Your Organizations</h1>
        <p className="text-gray-600 mt-1">
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
        <Card
          hover
          onClick={handleConnectOrg}
          className="border-2 border-dashed border-gray-300 hover:border-blue-400 flex items-center justify-center min-h-[200px]"
        >
          <CardContent className="flex flex-col items-center text-center">
            <Plus className="h-10 w-10 text-gray-400 mb-2" />
            <p className="text-sm font-medium text-gray-600">Connect Salesforce Org</p>
            <p className="text-xs text-gray-400 mt-1">OAuth login required</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
