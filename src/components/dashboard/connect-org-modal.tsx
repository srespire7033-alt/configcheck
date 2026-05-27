'use client';

import { useEffect, useState } from 'react';
import { X, Cloud, Copy, CheckCircle2, ChevronDown, ChevronUp, ShieldCheck, PlayCircle, Loader2, AlertCircle } from 'lucide-react';
import { track } from '@/lib/analytics/track-client';
import { AnalyticsEvent } from '@/lib/analytics/events';

// Optional Loom video showing the ECA setup walkthrough. Set this env var
// after recording the walkthrough Loom; until then, the slot stays hidden.
const LOOM_VIDEO_ID = process.env.NEXT_PUBLIC_LOOM_ECA_VIDEO_ID;

interface ConnectOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CALLBACK_URL = typeof window !== 'undefined'
  ? `${window.location.origin}/api/salesforce/callback`
  : '';

export function ConnectOrgModal({ isOpen, onClose }: ConnectOrgModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  // Test-credentials state machine. `testing` while the request is in
  // flight; `testResult` carries the {ok, message} payload from the
  // /api/salesforce/test-credentials endpoint. Cleared whenever the user
  // edits any of the three fields so they're not staring at a stale "OK"
  // banner from credentials they've since changed.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Fire one event per modal opening — useful for funnel "opens → submits".
  useEffect(() => {
    if (isOpen) {
      track(AnalyticsEvent.CONNECT_ORG_MODAL_OPENED, {
        source: typeof window !== 'undefined' ? window.location.pathname : null,
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConnect() {
    if (!clientId.trim()) {
      setError('Please enter a Consumer Key');
      return;
    }
    if (!clientSecret.trim()) {
      setError('Please enter a Consumer Secret');
      return;
    }
    if (!loginUrl.trim()) {
      setError('Please enter your Salesforce login URL');
      return;
    }

    setConnecting(true);
    setError('');
    track(AnalyticsEvent.ECA_CREDENTIALS_SUBMITTED, {
      // No credential values — just whether the user supplied one. The
      // login URL is sensitive (identifies the customer's org) so we don't
      // capture even the hostname.
      has_login_url: !!loginUrl.trim(),
    });
    try {
      const res = await fetch('/api/salesforce/auth-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          loginUrl: loginUrl.trim().replace(/\/+$/, ''),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start OAuth flow');
        setConnecting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Failed to start OAuth flow');
      setConnecting(false);
    }
  }

  function handleCopyCallback() {
    navigator.clipboard.writeText(CALLBACK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/salesforce/test-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          loginUrl: loginUrl.trim().replace(/\/+$/, ''),
        }),
      });
      const data = await res.json();
      setTestResult({
        ok: !!data.ok,
        message: data.message || (data.ok ? 'Credentials look good.' : 'Validation failed.'),
      });
    } catch {
      setTestResult({
        ok: false,
        message: 'Could not reach OrgPrism to run the test. Check your connection and try again.',
      });
    } finally {
      setTesting(false);
    }
  }

  // Clear the stale test result whenever the user edits any of the three
  // credentials fields — otherwise a green "Credentials look good" badge
  // could mislead them after they've changed the input.
  function setClientIdAndReset(v: string) { setClientId(v); setError(''); setTestResult(null); }
  function setClientSecretAndReset(v: string) { setClientSecret(v); setError(''); setTestResult(null); }
  function setLoginUrlAndReset(v: string) { setLoginUrl(v); setError(''); setTestResult(null); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700/60 w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Cloud className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Connect Salesforce Org
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {/* Walkthrough video — only renders when NEXT_PUBLIC_LOOM_ECA_VIDEO_ID
              is set. Saves the user 5+ minutes of reading by showing them
              exactly which Salesforce screens to click. Aspect ratio locked
              to 16:9 via the padding-top trick. */}
          {LOOM_VIDEO_ID && (
            <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black">
              <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                <iframe
                  src={`https://www.loom.com/embed/${LOOM_VIDEO_ID}?hide_owner=true&hide_share=true&hide_title=true`}
                  className="absolute inset-0 w-full h-full"
                  allowFullScreen
                  title="External Client App setup walkthrough"
                />
              </div>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                <PlayCircle className="h-3.5 w-3.5 text-blue-500" />
                Watch the 90-second walkthrough before you start
              </div>
            </div>
          )}

          {/* Why expander */}
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-left hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs font-medium text-blue-800 dark:text-blue-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Why does OrgPrism need my own External Client App?
            </span>
            {showWhy ? (
              <ChevronUp className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
            )}
          </button>
          {showWhy && (
            <div className="px-3.5 py-3 -mt-2 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/50 dark:border-blue-800/30 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
              Salesforce blocks OAuth refresh tokens from one org being used to authenticate users in another. By creating an External Client App inside your own org, OrgPrism stays connected permanently — no daily reconnects. Your credentials never leave your control: they live in your org, and OrgPrism only uses them to refresh access tokens.
            </div>
          )}

          {/* Setup instructions expander */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowInstructions((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                How to create an External Client App in your org (5 min)
              </span>
              {showInstructions ? (
                <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
              )}
            </button>
            {showInstructions && (
              <div className="px-3.5 py-3 text-xs text-gray-700 dark:text-gray-300 leading-relaxed border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0f172a]">
                <ol className="space-y-2 list-decimal list-inside">
                  <li>In your Salesforce org: <strong>Setup → External Client App Manager → New External Client App</strong></li>
                  <li>Name it <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">OrgPrism</code>. Contact email: yours.</li>
                  <li>Under <strong>API (Enable OAuth Settings)</strong>:
                    <ul className="mt-1 ml-4 space-y-0.5 list-disc list-inside text-[11px] text-gray-600 dark:text-gray-400">
                      <li>Check <strong>Enable OAuth</strong></li>
                      <li>Callback URL: paste the URL from the field below</li>
                      <li>OAuth Scopes: add <strong>Access the Salesforce API Platform (api)</strong> and <strong>Perform requests at any time (refresh_token, offline_access)</strong></li>
                      <li>Enable <strong>PKCE</strong> (Require Proof Key for Code Exchange)</li>
                      <li>Enable <strong>Secret required for Web Server Flow</strong></li>
                    </ul>
                  </li>
                  <li>Distribution State: <strong>Local</strong> (default)</li>
                  <li>Save → wait <strong>5–10 minutes</strong> for Salesforce to propagate</li>
                  <li>Open the new app → <strong>Policies</strong> tab → <strong>Edit</strong>:
                    <ul className="mt-1 ml-4 space-y-0.5 list-disc list-inside text-[11px] text-gray-600 dark:text-gray-400">
                      <li><strong>Refresh Token Policy: Refresh token is valid until revoked</strong> ← critical</li>
                      <li>IP Relaxation: <strong>Relax IP restrictions</strong></li>
                    </ul>
                  </li>
                  <li>Back to <strong>Settings → OAuth Settings → Consumer Key and Secret</strong> → copy both into the fields below</li>
                </ol>
              </div>
            )}
          </div>

          {/* Callback URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Callback URL <span className="text-gray-400 font-normal">(paste into your External Client App)</span>
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 truncate">
                {CALLBACK_URL}
              </code>
              <button
                onClick={handleCopyCallback}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
                title="Copy"
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4 text-gray-500" />
                )}
              </button>
            </div>
          </div>

          {/* Consumer Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Consumer Key (Client ID)
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientIdAndReset(e.target.value)}
              placeholder="3MVG9pRzvMkjMb6..."
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            />
          </div>

          {/* Consumer Secret */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Consumer Secret (Client Secret)
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecretAndReset(e.target.value)}
              placeholder="Enter consumer secret"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            />
          </div>

          {/* Login URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Salesforce Login URL <span className="text-gray-400 font-normal">(your My Domain)</span>
            </label>
            <input
              type="url"
              value={loginUrl}
              onChange={(e) => setLoginUrlAndReset(e.target.value)}
              placeholder="https://yourcompany.my.salesforce.com"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Find this in Setup → My Domain. For sandboxes, use your <code>--sandboxname.sandbox.my.salesforce.com</code> URL.
            </p>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Your credentials are encrypted at rest and only used to refresh access tokens against your org. OrgPrism requests read-only API scope — we can&apos;t modify any data in your Salesforce.
          </p>

          {/* Test-credentials result. Green when valid, amber when something
              is wrong before the user wastes the full OAuth round-trip. */}
          {testResult && (
            <div
              className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg border text-sm ${
                testResult.ok
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-800 dark:text-green-300'
                  : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <span className="leading-snug">{testResult.message}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-800/30">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          {/* Test button — requires Consumer Key + Login URL but NOT the
              Secret (we never send the secret over this endpoint). Disabled
              while testing or connecting. */}
          <button
            onClick={handleTest}
            disabled={testing || connecting || !clientId.trim() || !loginUrl.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Validate without going through the full OAuth flow"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {testing ? 'Testing…' : 'Test credentials'}
          </button>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 disabled:opacity-50 transition-all"
          >
            <Cloud className="h-3.5 w-3.5" />
            {connecting ? 'Connecting...' : 'Connect Org'}
          </button>
        </div>
      </div>
    </div>
  );
}
