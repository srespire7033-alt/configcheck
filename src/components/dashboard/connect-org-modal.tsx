'use client';

import { useState } from 'react';
import { X, Cloud, Key, Copy, CheckCircle2, ExternalLink, ChevronRight } from 'lucide-react';

interface ConnectOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CALLBACK_URL = typeof window !== 'undefined'
  ? `${window.location.origin}/api/salesforce/callback`
  : '';

export function ConnectOrgModal({ isOpen, onClose }: ConnectOrgModalProps) {
  const [mode, setMode] = useState<'choose' | 'custom'>('choose');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  async function handleDefaultConnect() {
    setConnecting(true);
    setError('');
    try {
      const res = await fetch('/api/salesforce/auth-url');
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setError('Failed to start OAuth flow');
      setConnecting(false);
    }
  }

  async function handleCustomConnect() {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-[#111827] rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700/60 w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Cloud className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {mode === 'choose' ? 'Connect Salesforce Org' : 'Your Connected App Credentials'}
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
        <div className="px-6 py-5">
          {mode === 'choose' ? (
            <div className="space-y-3">
              {/* Option 1: Default */}
              <button
                onClick={handleDefaultConnect}
                disabled={connecting}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Cloud className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    Quick Connect
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Works if your org is the same as where the Connected App is configured
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </button>

              {/* Option 2: Custom */}
              <button
                onClick={() => { setMode('custom'); setError(''); }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <Key className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    Use Your Own Connected App
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    For connecting to a different Salesforce org — provide your own credentials
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </button>

              <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center pt-1">
                ConfigCheck only requests read-only access to your configuration metadata.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Instructions */}
              <div className="p-3.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-2">
                  Create a Connected App in your Salesforce org:
                </p>
                <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
                  <li>Go to <strong>Setup → App Manager → New Connected App</strong></li>
                  <li>Enable OAuth Settings</li>
                  <li>Set the Callback URL below</li>
                  <li>Add scopes: <strong>Full access (full)</strong>, <strong>Perform requests at any time (refresh_token)</strong></li>
                  <li>Save, wait 2-10 minutes, then copy the Consumer Key & Secret</li>
                </ol>
              </div>

              {/* Callback URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Callback URL <span className="text-gray-400 font-normal">(copy this into your Connected App)</span>
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
                  onChange={(e) => { setClientId(e.target.value); setError(''); }}
                  placeholder="3MVG9pRzvMkjMb6..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  autoFocus
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
                  onChange={(e) => { setClientSecret(e.target.value); setError(''); }}
                  placeholder="Enter consumer secret"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>

              {/* Login URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Salesforce Login URL <span className="text-gray-400 font-normal">(My Domain)</span>
                </label>
                <input
                  type="url"
                  value={loginUrl}
                  onChange={(e) => { setLoginUrl(e.target.value); setError(''); }}
                  placeholder="https://yourcompany.my.salesforce.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  Find this in Setup → My Domain. Example: https://yourcompany.my.salesforce.com
                </p>
              </div>

              <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0" />
                Your credentials are encrypted and only used for OAuth with your org. ConfigCheck requests read-only access.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {mode === 'custom' && (
          <div className="flex justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-800/30">
            <button
              onClick={() => { setMode('choose'); setError(''); }}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleCustomConnect}
              disabled={connecting}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 disabled:opacity-50 transition-all"
            >
              <Cloud className="h-3.5 w-3.5" />
              {connecting ? 'Connecting...' : 'Connect Org'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
