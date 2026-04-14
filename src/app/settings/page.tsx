'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save, LogOut, Upload, X, BarChart3, Scan, FileText, Sparkles,
  Bell, BellOff, Shield, Crown, Building2, Palette, Image, User,
  Calendar, Mail, ChevronRight, CheckCircle2, Zap, TrendingUp,
  Clock, ArrowUpRight
} from 'lucide-react';
import { createClient } from '@/lib/db/client';
import { LoadingScreen } from '@/components/ui/loading-screen';

const PLAN_CONFIG: Record<string, {
  label: string;
  badge: string;
  color: string;
  bgColor: string;
  borderColor: string;
  iconColor: string;
  limits: { orgs: number | string; scans: number | string; ai: string; reports: string };
  features: string[];
}> = {
  free: {
    label: 'Free',
    badge: 'Free',
    color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-50 dark:bg-gray-800/50',
    borderColor: 'border-gray-200 dark:border-gray-700',
    iconColor: 'text-gray-500',
    limits: { orgs: 3, scans: 10, ai: '5 calls', reports: '5 PDFs' },
    features: ['Basic CPQ health checks', 'PDF reports', 'Email notifications'],
  },
  solo: {
    label: 'Solo',
    badge: 'Solo',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    iconColor: 'text-blue-500',
    limits: { orgs: 5, scans: 30, ai: '30 calls', reports: 'Unlimited' },
    features: ['Everything in Free', 'AI remediation plans', 'Scan comparison', 'Priority support'],
  },
  practice: {
    label: 'Practice',
    badge: 'Practice',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    iconColor: 'text-purple-500',
    limits: { orgs: 15, scans: 'Unlimited', ai: 'Unlimited', reports: 'Unlimited' },
    features: ['Everything in Solo', 'Scheduled scans', 'White-label reports', 'Team branding'],
  },
  partner: {
    label: 'Partner',
    badge: 'Partner',
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-500',
    limits: { orgs: 'Unlimited', scans: 'Unlimited', ai: 'Unlimited', reports: 'Unlimited' },
    features: ['Everything in Practice', 'Unlimited orgs', 'API access', 'Dedicated support'],
  },
};

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [companyName, setCompanyName] = useState('');
  const [brandingColor, setBrandingColor] = useState('#1B5E96');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('free');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [usage, setUsage] = useState<{
    total_scans: number;
    scans_this_month: number;
    ai_calls_this_month: number;
    pdf_reports_this_month: number;
  } | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setCompanyName(data.company_name || '');
          setBrandingColor(data.report_branding_color || '#1B5E96');
          setLogoUrl(data.company_logo_url || null);
          setEmail(data.email || '');
          setPlan(data.plan || 'free');
          setCreatedAt(data.created_at || null);
          setEmailNotifications(data.email_notifications_enabled !== false);
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();

    fetch('/api/usage')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => data && setUsage(data))
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Only PNG, SVG, JPEG, and WebP files are allowed');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);

      const res = await fetch('/api/auth/logo', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setLogoUrl(data.url);
      } else {
        const err = await res.json();
        alert(err.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveLogo() {
    setLogoUrl(null);
    await fetch('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_logo_url: null }),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          report_branding_color: brandingColor,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingScreen />;
  }

  const planConfig = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  const scanLimit = typeof planConfig.limits.scans === 'number' ? planConfig.limits.scans : null;
  const scanUsagePercent = scanLimit && usage ? Math.min((usage.scans_this_month / scanLimit) * 100, 100) : null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your account, branding, and preferences</p>
      </div>

      {/* ===== TOP SECTION: Profile Card + Plan ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

        {/* Profile Overview Card */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
          {/* Profile Header with gradient */}
          <div className="relative h-20 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500">
            <div className="absolute -bottom-8 left-6">
              <div className="w-16 h-16 rounded-xl border-4 border-white dark:border-[#111827] bg-white dark:bg-gray-800 flex items-center justify-center shadow-lg overflow-hidden">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain p-1" />
                ) : (
                  <Building2 className="w-7 h-7 text-gray-400" />
                )}
              </div>
            </div>
          </div>
          <div className="pt-12 px-6 pb-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {companyName || 'Your Company'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{email}</p>
            <div className="flex items-center gap-4 mt-4 text-xs text-gray-500 dark:text-gray-400">
              {memberSince && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Member since {memberSince}
                </span>
              )}
            </div>
            {/* Plan Badge */}
            <div className="mt-4">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${planConfig.bgColor} ${planConfig.color} border ${planConfig.borderColor}`}>
                {plan === 'partner' ? <Crown className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                {planConfig.label} Plan
              </span>
            </div>
          </div>
        </div>

        {/* Plan & Usage Card */}
        <div className="lg:col-span-3 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Usage This Month</h3>
            </div>
            <a
              href="/#pricing"
              className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
            >
              {plan === 'free' ? 'Upgrade Plan' : 'Change Plan'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="px-6 py-5">
            {usage ? (
              <div className="space-y-5">
                {/* Usage Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <UsageStat
                    icon={<Scan className="w-4 h-4" />}
                    value={usage.scans_this_month}
                    limit={scanLimit}
                    label="Scans"
                    color="blue"
                  />
                  <UsageStat
                    icon={<Sparkles className="w-4 h-4" />}
                    value={usage.ai_calls_this_month}
                    label="AI Calls"
                    color="purple"
                  />
                  <UsageStat
                    icon={<FileText className="w-4 h-4" />}
                    value={usage.pdf_reports_this_month}
                    label="PDF Reports"
                    color="green"
                  />
                  <UsageStat
                    icon={<BarChart3 className="w-4 h-4" />}
                    value={usage.total_scans}
                    label="All-time Scans"
                    color="gray"
                  />
                </div>

                {/* Scan Usage Bar (if limited) */}
                {scanUsagePercent !== null && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-gray-500 dark:text-gray-400">Monthly scan usage</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {usage.scans_this_month} / {scanLimit}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          scanUsagePercent > 80 ? 'bg-red-500' : scanUsagePercent > 60 ? 'bg-amber-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${scanUsagePercent}%` }}
                      />
                    </div>
                    {scanUsagePercent > 80 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {scanUsagePercent >= 100 ? 'Scan limit reached — upgrade to continue' : 'Approaching scan limit'}
                      </p>
                    )}
                  </div>
                )}

                {/* Plan Features */}
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Plan includes</p>
                  <div className="flex flex-wrap gap-2">
                    {planConfig.features.map((feature) => (
                      <span
                        key={feature}
                        className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded-md"
                      >
                        <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                Loading usage data...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== MIDDLE SECTION: Branding + Notifications ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Company & Branding */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Company & Branding</h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 ml-6">Customize white-label PDF reports with your brand</p>
          </div>
          <div className="px-6 py-5 space-y-5">
            {/* Company Name */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your consulting firm name"
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-gray-50 dark:bg-gray-800/50 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 transition-colors"
              />
            </div>

            {/* Brand Color */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Palette className="w-3.5 h-3.5 text-gray-400" />
                Brand Color
              </label>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="color"
                    value={brandingColor}
                    onChange={(e) => setBrandingColor(e.target.value)}
                    className="h-11 w-14 rounded-xl cursor-pointer border border-gray-200 dark:border-gray-600"
                  />
                </div>
                <div className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {brandingColor}
                </div>
                <div
                  className="h-11 w-24 rounded-xl border border-gray-200 dark:border-gray-600"
                  style={{ backgroundColor: brandingColor }}
                  title="Color preview"
                />
              </div>
            </div>

            {/* Company Logo */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Image className="w-3.5 h-3.5 text-gray-400" />
                Company Logo
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
              />
              {logoUrl ? (
                <div className="flex items-center gap-4 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-white dark:bg-gray-700 flex items-center justify-center border border-gray-100 dark:border-gray-600 flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain p-1" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">Logo uploaded</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Used in PDF report headers</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                    >
                      Change
                    </button>
                    <button
                      onClick={handleRemoveLogo}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                    >
                      <X className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-5 text-center hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all cursor-pointer disabled:opacity-50 group"
                >
                  {uploading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                      <span className="text-sm text-gray-500">Uploading...</span>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 mx-auto rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                        <Upload className="h-5 w-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Click to upload your logo</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, SVG, JPEG or WebP • Max 2MB</p>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                saved
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'
              } disabled:opacity-50`}
            >
              {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : saved ? 'Changes Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Preferences Column */}
        <div className="space-y-6">
          {/* Notifications */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 ml-6">Control how you receive updates</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Email Notifications Toggle */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    emailNotifications
                      ? 'bg-blue-100 dark:bg-blue-900/30'
                      : 'bg-gray-100 dark:bg-gray-800'
                  }`}>
                    {emailNotifications ? (
                      <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <BellOff className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Email Notifications</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Get notified when scans complete, fail, or find critical issues
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const newVal = !emailNotifications;
                    setEmailNotifications(newVal);
                    await fetch('/api/auth/me', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email_notifications_enabled: newVal }),
                    });
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 mt-1 ${
                    emailNotifications ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                      emailNotifications ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Scheduled Scan Alerts (informational) */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Scheduled Scan Alerts</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Automated scan results are emailed after each scheduled run
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Account & Security */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Account</h3>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Email */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{email}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-md">
                  <CheckCircle2 className="w-3 h-3" />
                  Verified
                </span>
              </div>

              {/* Sign Out */}
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <LogOut className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">Sign Out</span>
                </div>
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================== Sub-Components =================== */

function UsageStat({
  icon,
  value,
  limit,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  limit?: number | null;
  label: string;
  color: 'blue' | 'purple' | 'green' | 'gray';
}) {
  const colorMap = {
    blue: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      icon: 'text-blue-600 dark:text-blue-400',
      text: 'text-blue-700 dark:text-blue-300',
      sub: 'text-blue-600/70 dark:text-blue-400/70',
    },
    purple: {
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      icon: 'text-purple-600 dark:text-purple-400',
      text: 'text-purple-700 dark:text-purple-300',
      sub: 'text-purple-600/70 dark:text-purple-400/70',
    },
    green: {
      bg: 'bg-green-50 dark:bg-green-900/20',
      icon: 'text-green-600 dark:text-green-400',
      text: 'text-green-700 dark:text-green-300',
      sub: 'text-green-600/70 dark:text-green-400/70',
    },
    gray: {
      bg: 'bg-gray-50 dark:bg-gray-800',
      icon: 'text-gray-600 dark:text-gray-400',
      text: 'text-gray-700 dark:text-gray-300',
      sub: 'text-gray-500 dark:text-gray-400',
    },
  };

  const c = colorMap[color];

  return (
    <div className={`${c.bg} rounded-xl p-3 text-center`}>
      <div className={`${c.icon} flex justify-center mb-1.5`}>{icon}</div>
      <p className={`text-xl font-bold ${c.text}`}>
        {value}
        {limit && <span className={`text-xs font-normal ${c.sub}`}>/{limit}</span>}
      </p>
      <p className={`text-xs ${c.sub} mt-0.5`}>{label}</p>
    </div>
  );
}
