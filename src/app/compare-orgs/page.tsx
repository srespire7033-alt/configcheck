'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, GitCompare, Loader2, Server, Cloud, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DBOrganization } from '@/types';

interface DiffItem {
  name: string;
  type: string;
  inOrgA: boolean;
  inOrgB: boolean;
  activeInA?: boolean;
  activeInB?: boolean;
  detailsA?: string;
  detailsB?: string;
}

interface CompareResult {
  orgA: { id: string; name: string; isSandbox: boolean };
  orgB: { id: string; name: string; isSandbox: boolean };
  diff: Record<string, DiffItem[]>;
  summary: {
    totalCompared: number;
    onlyInOrgA: number;
    onlyInOrgB: number;
    inBoth: number;
    activeDifferences: number;
  };
  counts: Record<string, Record<string, number>>;
}

const CATEGORY_LABELS: Record<string, string> = {
  priceRules: 'Price Rules',
  productRules: 'Product Rules',
  discountSchedules: 'Discount Schedules',
  products: 'Products',
  approvalRules: 'Approval Rules',
  customScripts: 'Custom Scripts (QCP)',
  quoteTemplates: 'Quote Templates',
  summaryVariables: 'Summary Variables',
  guidedSellingProcesses: 'Guided Selling',
};

export default function CompareOrgsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<DBOrganization[]>([]);
  const [orgAId, setOrgAId] = useState('');
  const [orgBId, setOrgBId] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrgs() {
      try {
        const res = await fetch('/api/orgs');
        if (res.ok) setOrgs(await res.json());
      } catch (e) {
        console.error('Failed to fetch orgs:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchOrgs();
  }, []);

  async function handleCompare() {
    if (!orgAId || !orgBId) return;
    setComparing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/scans/compare-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgAId, orgBId }),
      });
      if (res.ok) {
        setResult(await res.json());
      } else {
        const data = await res.json();
        setError(data.error || 'Comparison failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setComparing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (orgs.length < 2) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Sandbox vs Production</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">You need at least 2 connected Salesforce orgs to compare (e.g., one Sandbox and one Production).</p>
            <p className="text-sm text-gray-400 mt-2">Connect another org from the dashboard first.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sandbox vs Production</h1>
          <p className="text-sm text-gray-500 mt-0.5">Compare CPQ configurations between two Salesforce orgs</p>
        </div>
      </div>

      {/* Org Selectors */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase">Org A (e.g., Production)</label>
              <select
                value={orgAId}
                onChange={(e) => setOrgAId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select org...</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id} disabled={org.id === orgBId}>
                    {org.name} ({org.is_sandbox ? 'Sandbox' : 'Production'})
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-400 mt-5 flex-shrink-0" />
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase">Org B (e.g., Sandbox)</label>
              <select
                value={orgBId}
                onChange={(e) => setOrgBId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select org...</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id} disabled={org.id === orgAId}>
                    {org.name} ({org.is_sandbox ? 'Sandbox' : 'Production'})
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCompare}
              disabled={!orgAId || !orgBId || comparing}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2 mt-5"
            >
              {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
              {comparing ? 'Comparing...' : 'Compare'}
            </button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {comparing && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
          <p className="text-sm text-gray-500">Fetching and comparing configurations from both orgs...</p>
          <p className="text-xs text-gray-400 mt-1">This may take 30-60 seconds</p>
        </div>
      )}

      {/* Results */}
      {result && !comparing && (
        <div className="space-y-6">
          {/* Summary Hero */}
          <Card>
            <CardContent className="py-8">
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {result.orgA.isSandbox ? <Cloud className="w-5 h-5 text-blue-500" /> : <Server className="w-5 h-5 text-green-600" />}
                    <p className="text-xs font-medium text-gray-500 uppercase">
                      {result.orgA.isSandbox ? 'Sandbox' : 'Production'}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{result.orgA.name}</p>
                </div>

                <div className="text-center px-8">
                  <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">{result.summary.totalCompared} differences found</p>
                </div>

                <div className="text-center flex-1">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {result.orgB.isSandbox ? <Cloud className="w-5 h-5 text-blue-500" /> : <Server className="w-5 h-5 text-green-600" />}
                    <p className="text-xs font-medium text-gray-500 uppercase">
                      {result.orgB.isSandbox ? 'Sandbox' : 'Production'}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{result.orgB.name}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{result.summary.onlyInOrgA}</p>
                <p className="text-xs text-gray-500 mt-1">Only in {result.orgA.name}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-purple-600">{result.summary.onlyInOrgB}</p>
                <p className="text-xs text-gray-500 mt-1">Only in {result.orgB.name}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-amber-600">{result.summary.activeDifferences}</p>
                <p className="text-xs text-gray-500 mt-1">Active/Inactive Mismatch</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-gray-500">{result.summary.inBoth}</p>
                <p className="text-xs text-gray-500 mt-1">In Both (with differences)</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-Category Diffs */}
          {Object.entries(result.diff).map(([category, items]) => (
            items.length > 0 && (
              <DiffSection
                key={category}
                category={CATEGORY_LABELS[category] || category}
                items={items}
                orgAName={result.orgA.name}
                orgBName={result.orgB.name}
              />
            )
          ))}

          {result.summary.totalCompared === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-lg font-semibold text-green-600">Configurations are in sync!</p>
                <p className="text-sm text-gray-500 mt-1">No differences found between the two orgs.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function DiffSection({ category, items, orgAName, orgBName }: {
  category: string;
  items: DiffItem[];
  orgAName: string;
  orgBName: string;
}) {
  const [expanded, setExpanded] = useState(true);

  const onlyInA = items.filter((i) => i.inOrgA && !i.inOrgB);
  const onlyInB = items.filter((i) => !i.inOrgA && i.inOrgB);
  const mismatch = items.filter((i) => i.inOrgA && i.inOrgB);

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{category}</h3>
            <Badge variant="default">{items.length} difference{items.length !== 1 ? 's' : ''}</Badge>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {/* Only in Org A */}
            {onlyInA.map((item) => (
              <div key={`a-${item.name}`} className="px-5 py-3 border-l-4 border-l-blue-400">
                <div className="flex items-center gap-3">
                  <Badge variant="info">Only in {orgAName}</Badge>
                  <span className="text-sm font-medium text-gray-900">{item.name}</span>
                  {item.activeInA !== undefined && (
                    <span className={`text-xs ${item.activeInA ? 'text-green-600' : 'text-gray-400'}`}>
                      {item.activeInA ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>
                {item.detailsA && <p className="text-xs text-gray-500 mt-1 ml-28">{item.detailsA}</p>}
              </div>
            ))}

            {/* Only in Org B */}
            {onlyInB.map((item) => (
              <div key={`b-${item.name}`} className="px-5 py-3 border-l-4 border-l-purple-400">
                <div className="flex items-center gap-3">
                  <Badge variant="warning">Only in {orgBName}</Badge>
                  <span className="text-sm font-medium text-gray-900">{item.name}</span>
                  {item.activeInB !== undefined && (
                    <span className={`text-xs ${item.activeInB ? 'text-green-600' : 'text-gray-400'}`}>
                      {item.activeInB ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>
                {item.detailsB && <p className="text-xs text-gray-500 mt-1 ml-28">{item.detailsB}</p>}
              </div>
            ))}

            {/* Active/Inactive mismatch */}
            {mismatch.map((item) => (
              <div key={`m-${item.name}`} className="px-5 py-3 border-l-4 border-l-amber-400">
                <div className="flex items-center gap-3">
                  <Badge variant="critical">Mismatch</Badge>
                  <span className="text-sm font-medium text-gray-900">{item.name}</span>
                  <span className="text-xs text-gray-500">
                    {orgAName}: <span className={item.activeInA ? 'text-green-600' : 'text-red-500'}>{item.activeInA ? 'Active' : 'Inactive'}</span>
                    {' → '}
                    {orgBName}: <span className={item.activeInB ? 'text-green-600' : 'text-red-500'}>{item.activeInB ? 'Active' : 'Inactive'}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
