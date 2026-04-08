'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DBIssue, DBOrganization } from '@/types';

export default function IssueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;
  const issueId = params.issueId as string;

  const [issue, setIssue] = useState<DBIssue | null>(null);
  const [org, setOrg] = useState<DBOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingFix, setGeneratingFix] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  async function fetchData() {
    try {
      const [issueRes, orgRes] = await Promise.all([
        fetch(`/api/issues?issueId=${issueId}`),
        fetch(`/api/orgs?orgId=${orgId}`),
      ]);

      if (issueRes.ok) setIssue(await issueRes.json());
      if (orgRes.ok) setOrg(await orgRes.json());
    } catch (error) {
      console.error('Failed to fetch:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFix() {
    setGeneratingFix(true);
    try {
      const res = await fetch('/api/ai/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });
      const { suggestion } = await res.json();
      setIssue((prev) => prev ? { ...prev, ai_fix_suggestion: suggestion } : null);
    } catch (error) {
      console.error('Failed to generate fix:', error);
    } finally {
      setGeneratingFix(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    try {
      await fetch('/api/issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, status: newStatus }),
      });
      setIssue((prev) => prev ? { ...prev, status: newStatus as DBIssue['status'] } : null);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  }

  if (loading || !issue) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={issue.severity}>{issue.severity}</Badge>
            <span className="text-xs font-mono text-gray-400">{issue.check_id}</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{issue.title}</h1>
        </div>
        {/* Status dropdown */}
        <select
          value={issue.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        >
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
      </div>

      {/* What's Wrong */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">What&apos;s Wrong</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.description}</p>
        </CardContent>
      </Card>

      {/* Why It Matters */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">Why It Matters</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.impact}</p>
        </CardContent>
      </Card>

      {/* What To Change */}
      <Card className="mb-4">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">What To Change</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700">{issue.recommendation}</p>
        </CardContent>
      </Card>

      {/* AI Fix Suggestion */}
      <Card className="mb-4 border-purple-200">
        <CardHeader className="bg-purple-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <h3 className="text-sm font-semibold text-purple-900">AI Fix Suggestion</h3>
            </div>
            {!issue.ai_fix_suggestion && (
              <button
                onClick={handleGenerateFix}
                disabled={generatingFix}
                className="px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-full hover:bg-purple-200 disabled:opacity-50"
              >
                {generatingFix ? 'Generating...' : 'Generate Fix'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {issue.ai_fix_suggestion ? (
            <p className="text-sm text-gray-700 whitespace-pre-line">{issue.ai_fix_suggestion}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">
              Click &quot;Generate Fix&quot; to get a detailed, step-by-step fix from AI.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Affected Records */}
      {issue.affected_records && issue.affected_records.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-gray-900">Affected Records</h3>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {issue.affected_records.map((record, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-400">{record.type}</span>
                  <span className="text-gray-700">{record.name}</span>
                  {org?.instance_url && (
                    <a
                      href={`${org.instance_url}/lightning/r/${record.type}/${record.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
