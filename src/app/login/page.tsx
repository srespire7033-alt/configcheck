'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle, Zap, BarChart3, FileText } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { createClient } from '@/lib/db/client';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetMode, setResetMode] = useState(false);

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setLoading(true);
    setError('');
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      setError('Password reset link sent! Check your email.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
          },
        });
        if (error) throw error;

        // Supabase returns a fake user with no identities if email already exists
        // (to prevent email enumeration). Detect this and show a clear message.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError('An account with this email already exists. Please sign in instead.');
          setLoading(false);
          return;
        }

        setError('Check your email for a confirmation link!');
        setLoading(false);
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-300 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="mb-8">
            <Logo size="lg" variant="white" />
          </div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">
            AI-Driven Config Audits<br />for Salesforce Revenue Cloud
          </h1>
          <p className="text-blue-100 text-lg mb-10 max-w-md">
            Connect your Salesforce orgs, detect misconfigurations, and deliver professional audit reports to your clients.
          </p>

          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-white/20 rounded-lg mt-0.5">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold">100+ Health Checks</p>
                <p className="text-sm text-blue-200">CPQ, Billing &amp; ARM — price rules, products, invoicing &amp; more</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-white/20 rounded-lg mt-0.5">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold">AI-Powered Analysis</p>
                <p className="text-sm text-blue-200">Gemini AI generates fix suggestions & executive summaries</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-white/20 rounded-lg mt-0.5">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold">White-Label PDF Reports</p>
                <p className="text-sm text-blue-200">Branded reports with AI remediation plans</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-6">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="flex justify-center mb-8 lg:hidden">
            <Logo size="lg" />
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-[#111827] rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-black/30 border border-gray-100 dark:border-gray-800 p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              {resetMode ? 'Reset your password' : isSignUp ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
              {resetMode
                ? 'Enter your email and we\'ll send a reset link'
                : isSignUp
                  ? 'Start auditing Salesforce Revenue Cloud configurations'
                  : 'Sign in to your ConfigCheck account'}
            </p>

            <form onSubmit={resetMode ? handlePasswordReset : handleSubmit} className="space-y-5">
              {isSignUp && !resetMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    placeholder="Your name"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="you@company.com"
                />
              </div>
              {!resetMode && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                    {!isSignUp && (
                      <button
                        type="button"
                        onClick={() => { setResetMode(true); setError(''); }}
                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    placeholder="Min 6 characters"
                  />
                </div>
              )}

              {error && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
                  error.includes('Check your email') || error.includes('reset link sent')
                    ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                    : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                }`}>
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all duration-200 flex items-center justify-center gap-2 shadow-sm shadow-blue-600/30 hover:shadow-md hover:shadow-blue-600/40"
              >
                {loading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <>
                    {resetMode ? 'Send Reset Link' : isSignUp ? 'Create Account' : 'Sign In'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center space-y-2">
              {resetMode ? (
                <button
                  onClick={() => { setResetMode(false); setError(''); }}
                  className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 transition-colors"
                >
                  Back to sign in
                </button>
              ) : (
                <button
                  onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
                  className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 transition-colors"
                >
                  {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-400 text-center mt-6">
            Built for Salesforce Revenue Cloud consulting firms
          </p>
        </div>
      </div>
    </div>
  );
}
