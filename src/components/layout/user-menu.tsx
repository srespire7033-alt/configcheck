'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Settings as SettingsIcon, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/db/client';

/**
 * Avatar dropdown in the top-right of the app header. Replaces the Sign
 * Out button that previously sat in the Settings sidebar (one stray
 * click logged the user out mid-edit). Confirms before signing out so
 * keystrokes-in-flight don't get nuked.
 */
export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEmail(data.email || null);
        setFullName(data.full_name || null);
        setAvatarUrl(data.avatar_url || null);
      })
      .catch(() => {});
    // Refetch when other tabs / the settings page broadcasts an avatar
    // change so the header pic updates in real time.
    function onAvatarUpdated(e: Event) {
      const next = (e as CustomEvent<{ url: string | null }>).detail?.url;
      setAvatarUrl(next ?? null);
    }
    window.addEventListener('orgprism:avatar-updated', onAvatarUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('orgprism:avatar-updated', onAvatarUpdated);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open && !confirmingSignOut) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, confirmingSignOut]);

  async function doSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const initials = (fullName || email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={fullName || 'You'}
            className="w-7 h-7 rounded-full object-cover bg-gray-100 dark:bg-gray-800"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center">
            {initials}
          </div>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{fullName || 'Signed in'}</p>
            {email && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{email}</p>}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              router.push('/settings');
            }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => setConfirmingSignOut(true)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-t border-gray-100 dark:border-gray-800"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}

      {confirmingSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !signingOut && setConfirmingSignOut(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-sm w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Sign out?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              You can sign back in any time with the same account.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmingSignOut(false)}
                disabled={signingOut}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doSignOut}
                disabled={signingOut}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {signingOut && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
