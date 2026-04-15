'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Users, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Logo } from '@/components/ui/logo';

interface InvitationInfo {
  team_name: string;
  email: string;
  role: string;
}

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchInvitation() {
      try {
        const res = await fetch(`/api/invitations/${token}`);
        if (res.ok) {
          const data = await res.json();
          setInvitation(data);
        } else {
          const data = await res.json();
          setError(data.error || 'Invalid or expired invitation');
        }
      } catch {
        setError('Failed to load invitation details');
      } finally {
        setLoading(false);
      }
    }
    fetchInvitation();
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError('');

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push('/team'), 1500);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to accept invitation');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50 dark:bg-[#0a0f1a]">
      <div className="mb-8">
        <Logo size="lg" />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm overflow-hidden">
        <div className="flex flex-col items-center pt-8 pb-6 px-6">
          {/* Icon */}
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg mb-5 ${
            success
              ? 'bg-gradient-to-br from-green-500 to-emerald-500 shadow-green-500/20'
              : error && !invitation
              ? 'bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/20'
              : 'bg-gradient-to-br from-blue-500 to-teal-500 shadow-blue-500/20'
          }`}>
            {loading ? (
              <Loader2 className="h-8 w-8 text-white animate-spin" />
            ) : success ? (
              <CheckCircle className="h-8 w-8 text-white" />
            ) : error && !invitation ? (
              <XCircle className="h-8 w-8 text-white" />
            ) : (
              <Users className="h-8 w-8 text-white" />
            )}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="text-center">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Loading Invitation</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Please wait...</p>
            </div>
          )}

          {/* Success state */}
          {success && (
            <div className="text-center">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Welcome to the Team!</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Redirecting you to the team dashboard...</p>
            </div>
          )}

          {/* Error state (no invitation data) */}
          {!loading && error && !invitation && (
            <div className="text-center">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Invalid Invitation</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{error}</p>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 transition-all"
              >
                Go to Dashboard
              </button>
            </div>
          )}

          {/* Invitation details */}
          {!loading && !success && invitation && (
            <div className="text-center w-full">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                You&apos;re Invited!
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                You&apos;ve been invited to join a team on ConfigCheck
              </p>

              {/* Team info card */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-5 mb-6">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{invitation.team_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Role: <span className="capitalize font-medium">{invitation.role}</span></p>
                  </div>
                </div>
              </div>

              {/* Error (with invitation) */}
              {error && (
                <div className="px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400 mb-4">
                  {error}
                </div>
              )}

              {/* Accept button */}
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200 dark:shadow-blue-900/30 disabled:opacity-50 transition-all"
              >
                {accepting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Accept Invitation
                  </>
                )}
              </button>

              <button
                onClick={() => router.push('/dashboard')}
                className="mt-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Decline and go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
