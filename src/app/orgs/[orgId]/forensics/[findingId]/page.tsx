'use client';

/**
 * Forensic finding detail page — THE hero experience.
 *
 * This is the screen we expect a consultant or admin to spend the most
 * time on. The brief called it "the attribution drill-down — gap → root
 * config object → plain-English cause → recovery preview."
 *
 * Structure:
 *   1. Top: verified $ gap headline + the affected record
 *   2. Attribution trace: root cause class, config object (deep-link to
 *      Salesforce Setup), AI-rendered explanation grounded in evidence
 *   3. Evidence panel: the deterministic facts the rules engine used
 *      (rule conditions, action target, run order, etc.)
 *   4. Recovery action: "Download recovery CSV" button + projected reclaim
 *
 * No PII rendered anywhere — only record names/numbers + IDs.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Wrench,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface SourceRecord {
  type: string;
  id: string;
  name: string;
  financials?: Record<string, number | string | null>;
}

interface Finding {
  id: string;
  detector_id: string;
  severity: 'critical' | 'warning' | 'info';
  entitled_usd: number;
  realized_usd: number;
  gap_usd: number;
  currency_iso_code: string;
  recoverability_score: number;
  title: string;
  description: string | null;
  status: string;
  detected_at: string;
  source_record_refs: {
    primary_record: SourceRecord;
    supporting_records: SourceRecord[];
  };
  metadata: Record<string, unknown>;
}

interface RecoveryActionData {
  id: string;
  approval_status: 'pending' | 'approved' | 'committed' | 'rejected' | 'expired';
  projected_reclaim_usd: number;
  approved_at: string | null;
  committed_at: string | null;
  created_at: string;
}

interface Trace {
  id: string;
  root_cause_class: 'A' | 'B' | 'C' | 'D' | 'E';
  root_config_type: string;
  root_config_id: string | null;
  root_config_name: string;
  reason_code: string;
  confidence: number;
  evidence: Record<string, unknown>;
  ai_explanation: string | null;
  ai_suggested_fix: string | null;
  ai_model: string | null;
}

const ROOT_CAUSE_LABELS: Record<string, string> = {
  A: 'Process & system disconnect',
  B: 'Manual override',
  C: 'Conflicting automation',
  D: 'Missing governance',
  E: 'Poor data quality',
};

function formatMoney(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default function ForensicFindingPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const findingId = params?.findingId as string;
  const [finding, setFinding] = useState<Finding | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [recoveryActions, setRecoveryActions] = useState<RecoveryActionData[]>([]);
  const [orgInstanceUrl, setOrgInstanceUrl] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [stagingInFlight, setStagingInFlight] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/forensic-findings?findingId=${findingId}`).then((r) => r.json()),
      fetch(`/api/orgs?id=${orgId}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([detailRes, orgRes]) => {
        if (detailRes.error) {
          setError(detailRes.error);
          return;
        }
        setFinding(detailRes.finding);
        setTraces(detailRes.traces);
        setRecoveryActions(detailRes.recovery_actions ?? []);
        if (orgRes?.instance_url) setOrgInstanceUrl(orgRes.instance_url);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load finding'))
      .finally(() => setLoading(false));
  }, [findingId, orgId]);

  async function handleStage() {
    setStagingInFlight(true);
    try {
      const res = await fetch(`/api/forensic-findings/${findingId}/stage`, { method: 'POST' });
      const json = await res.json();
      if (json.action) {
        setRecoveryActions((prev) => {
          const without = prev.filter((p) => p.id !== json.action.id);
          return [json.action, ...without];
        });
      }
    } finally {
      setStagingInFlight(false);
    }
  }

  async function handleBulkAction(actionId: string, action: 'approve' | 'reject' | 'commit' | 'stage') {
    setStagingInFlight(true);
    try {
      await fetch('/api/recovery-actions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [actionId], action }),
      });
      // Refetch to get fresh status + timestamps.
      const res = await fetch(`/api/forensic-findings?findingId=${findingId}`);
      const json = await res.json();
      setRecoveryActions(json.recovery_actions ?? []);
    } finally {
      setStagingInFlight(false);
    }
  }

  if (loading) return <LoadingScreen />;
  if (error || !finding) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="text-gray-700 dark:text-gray-300">{error ?? 'Finding not found'}</p>
          <Link href={`/orgs/${orgId}`} className="text-blue-600 dark:text-blue-400 mt-2 inline-block">
            ← Back to org
          </Link>
        </div>
      </div>
    );
  }

  const primaryTrace = traces[0] ?? null;
  const recoverableUsd = finding.gap_usd * finding.recoverability_score;

  // Deep-link to the affected Salesforce record (one click → SF Setup
  // page) when we know the org's instance_url. Falls back to /lightning/
  // path; if the org uses Classic this might land off-page but the URL
  // pattern is widely correct.
  const sfRecordUrl = orgInstanceUrl
    ? `${orgInstanceUrl}/lightning/r/${finding.source_record_refs.primary_record.type}/${finding.source_record_refs.primary_record.id}/view`
    : null;
  const sfRootConfigUrl =
    orgInstanceUrl && primaryTrace?.root_config_id
      ? `${orgInstanceUrl}/lightning/r/${primaryTrace.root_config_type}/${primaryTrace.root_config_id}/view`
      : null;

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link
          href={`/orgs/${orgId}`}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to org
        </Link>

        {/* 1. Headline */}
        <Card className="border-amber-200 dark:border-amber-800/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-900/10">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                  <TrendingDown className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs font-mono px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                      {finding.detector_id}
                    </code>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      ✓ Verified
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{finding.title}</h1>
                  {finding.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{finding.description}</p>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Verified gap</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {formatMoney(finding.gap_usd, finding.currency_iso_code)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Recoverable</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {formatMoney(recoverableUsd, finding.currency_iso_code)}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {Math.round(finding.recoverability_score * 100)}% expected to recover
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Entitled</p>
                <p className="text-lg font-mono text-gray-900 dark:text-white">
                  {formatMoney(finding.entitled_usd, finding.currency_iso_code)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Realized</p>
                <p className="text-lg font-mono text-gray-900 dark:text-white">
                  {formatMoney(finding.realized_usd, finding.currency_iso_code)}
                </p>
              </div>
            </div>

            {/* Primary affected record */}
            <div className="mt-5 pt-4 border-t border-amber-200 dark:border-amber-800/40">
              <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                Affected record
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <code className="text-xs font-mono text-gray-500 dark:text-gray-400">
                    {finding.source_record_refs.primary_record.type}
                  </code>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {finding.source_record_refs.primary_record.name}
                  </p>
                </div>
                {sfRecordUrl && (
                  <a
                    href={sfRecordUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open in Salesforce <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Attribution trace — THE hero panel */}
        {primaryTrace ? (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-500" />
                Root cause
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Our root-cause analysis, explained in plain English.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  Class {primaryTrace.root_cause_class} · {ROOT_CAUSE_LABELS[primaryTrace.root_cause_class]}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Confidence {Math.round(primaryTrace.confidence * 100)}%
                </span>
                <code className="text-[11px] font-mono text-gray-400">{primaryTrace.reason_code}</code>
              </div>

              {/* Root config object — deep-link */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-900/40 p-4 mb-4">
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Identified config object
                </p>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <code className="text-xs font-mono text-gray-500 dark:text-gray-400">
                      {primaryTrace.root_config_type}
                    </code>
                    <p className="font-semibold text-gray-900 dark:text-white">{primaryTrace.root_config_name}</p>
                  </div>
                  {sfRootConfigUrl && (
                    <a
                      href={sfRootConfigUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                    >
                      Open in Salesforce <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* AI-rendered explanation */}
              {primaryTrace.ai_explanation && (
                <div className="rounded-xl bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 p-4 mb-3">
                  <p className="text-[11px] uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> What we found
                  </p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                    {primaryTrace.ai_explanation}
                  </p>
                  {primaryTrace.ai_model && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                      Rendered by {primaryTrace.ai_model}
                    </p>
                  )}
                </div>
              )}

              {/* Suggested fix */}
              {primaryTrace.ai_suggested_fix && (
                <div className="rounded-xl bg-green-50/40 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-green-700 dark:text-green-400 mb-1 flex items-center gap-1">
                    <Wrench className="h-3 w-3" /> Suggested fix
                  </p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                    {primaryTrace.ai_suggested_fix}
                  </p>
                </div>
              )}

              {/* 3. Evidence panel — collapsed by default */}
              <button
                onClick={() => setEvidenceOpen((v) => !v)}
                className="mt-3 w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <span>Show the evidence behind this diagnosis</span>
                {evidenceOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {evidenceOpen && (
                <pre className="mt-2 rounded-lg bg-gray-900 dark:bg-gray-950 text-gray-100 p-3 text-[11px] overflow-x-auto">
                  {JSON.stringify(primaryTrace.evidence, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                We couldn&rsquo;t pin this finding to a single root configuration — the underlying cause
                may span multiple settings or involve custom logic. Open the record in Salesforce Setup
                or check with your Salesforce admin to investigate further.
              </p>
            </CardContent>
          </Card>
        )}

        {/* 4. Recovery action — state-aware. Stage → Approve → Commit. */}
        {(() => {
          const action = recoveryActions[0]; // most recent
          const status = action?.approval_status;
          return (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Recovery
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Stage this finding, approve it, download the CSV, upload to Salesforce via Data Loader, then mark complete.
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Projected reclaim
                    </p>
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                      {formatMoney(recoverableUsd, finding.currency_iso_code)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {Math.round(finding.recoverability_score * 100)}% of {formatMoney(finding.gap_usd, finding.currency_iso_code)} gap
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* State machine action buttons */}
                    {!action && (
                      <button
                        onClick={handleStage}
                        disabled={stagingInFlight}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition disabled:opacity-50"
                      >
                        Stage for recovery
                      </button>
                    )}
                    {status === 'pending' && (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                          Pending review
                        </span>
                        <button
                          onClick={() => handleBulkAction(action.id, 'approve')}
                          disabled={stagingInFlight}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Approve
                        </button>
                        <button
                          onClick={() => handleBulkAction(action.id, 'reject')}
                          disabled={stagingInFlight}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {status === 'approved' && (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          Approved
                        </span>
                        <a
                          href={`/api/forensic-findings/${findingId}/recovery-csv`}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold transition"
                        >
                          <Download className="h-4 w-4" /> Download CSV
                        </a>
                        <button
                          onClick={() => handleBulkAction(action.id, 'commit')}
                          disabled={stagingInFlight}
                          title="Mark committed AFTER uploading the CSV to Salesforce"
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          Mark committed
                        </button>
                      </>
                    )}
                    {status === 'committed' && (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                        <CheckCircle2 className="h-4 w-4" /> Committed
                      </span>
                    )}
                    {(status === 'rejected' || status === 'expired') && (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                          {status === 'rejected' ? 'Rejected' : 'Expired'}
                        </span>
                        <button
                          onClick={() => handleBulkAction(action.id, 'stage')}
                          disabled={stagingInFlight}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
                        >
                          Re-stage
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {action && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Recovery action created {new Date(action.created_at).toLocaleString()}
                      {action.approved_at && ` · Approved ${new Date(action.approved_at).toLocaleString()}`}
                      {action.committed_at && ` · Committed ${new Date(action.committed_at).toLocaleString()}`}
                      {' · '}
                      <a
                        href={`/orgs/${orgId}/forensics/recovery`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View recovery queue
                      </a>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Supporting records */}
        {finding.source_record_refs.supporting_records.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Supporting records</h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {finding.source_record_refs.supporting_records.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{r.type}</code>
                      <span className="text-gray-800 dark:text-gray-200 truncate">{r.name}</span>
                    </div>
                    {orgInstanceUrl && (
                      <a
                        href={`${orgInstanceUrl}/lightning/r/${r.type}/${r.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
