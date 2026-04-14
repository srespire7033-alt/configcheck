'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save, LogOut, Upload, X, Scan, FileText, Sparkles,
  Bell, BellOff, Crown, Shield, CheckCircle2, Zap,
  BarChart3, Clock, ExternalLink, Copy, Check
} from 'lucide-react';
import { createClient } from '@/lib/db/client';
import { LoadingScreen } from '@/components/ui/loading-screen';

const PLAN_INFO: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: typeof Shield;
  limits: { orgs: string; scans: string; ai: string; reports: string };
}> = {
  free: {
    label: 'Free',
    color: 'text-gray-700 dark:text-gray-300',
    bg: 'bg-gray-100 dark:bg-gray-800',
    border: 'border-gray-200 dark:border-gray-700',
    icon: Shield,
    limits: { orgs: '3 orgs', scans: '10 / month', ai: '5 / month', reports: '5 / month' },
  },
  solo: {
    label: 'Solo',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Shield,
    limits: { orgs: '5 orgs', scans: '30 / month', ai: '30 / month', reports: 'Unlimited' },
  },
  practice: {
    label: 'Practice',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    icon: Crown,
    limits: { orgs: '15 orgs', scans: 'Unlimited', ai: 'Unlimited', reports: 'Unlimited' },
  },
  partner: {
    label: 'Partner',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    icon: Crown,
    limits: { orgs: 'Unlimited', scans: 'Unlimited', ai: 'Unlimited', reports: 'Unlimited' },
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
  const [copiedEmail, setCopiedEmail] = useState(false);
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

  function copyEmail() {
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  }

  if (loading) {
    return <LoadingScreen />;
  }

  const planInfo = PLAN_INFO[plan] || PLAN_INFO.free;
  const PlanIcon = planInfo.icon;
  const scanLimit = plan === 'free' ? 10 : plan === 'solo' ? 30 : null;
  const scanPercent = scanLimit && usage ? Math.min((usage.scans_this_month / scanLimit) * 100, 100) : null;
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      </div>

      {/* ===== SECTION: Account ===== */}
      <Section
        title="Account"
        description="Your account information and login details."
      >
        <div className="space-y-4">
          <SettingRow label="Email">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-900 dark:text-white font-medium">{email}</span>
              <button
                onClick={copyEmail}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Copy email"
              >
                {copiedEmail ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </SettingRow>
          {memberSince && (
            <SettingRow label="Member since">
              <span className="text-sm text-gray-600 dark:text-gray-400">{memberSince}</span>
            </SettingRow>
          )}
          <SettingRow label="Session">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </SettingRow>
        </div>
      </Section>

      {/* ===== SECTION: Plan ===== */}
      <Section
        title="Plan"
        description="Your current subscription and usage limits."
        action={
          <a
            href="/#pricing"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            Upgrade
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        }
      >
        <div className="space-y-5">
          {/* Current Plan Badge */}
          <div className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border ${planInfo.border} ${planInfo.bg}`}>
            <PlanIcon className={`w-4 h-4 ${planInfo.color}`} />
            <span className={`text-sm font-semibold ${planInfo.color}`}>{planInfo.label} Plan</span>
          </div>

          {/* Plan Limits Table */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                <LimitRow label="Connected Orgs" value={planInfo.limits.orgs} />
                <LimitRow label="Scans" value={planInfo.limits.scans} />
                <LimitRow label="AI Calls" value={planInfo.limits.ai} />
                <LimitRow label="PDF Reports" value={planInfo.limits.reports} />
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ===== SECTION: Usage ===== */}
      <Section
        title="Usage This Month"
        description="Track your monthly consumption across features."
      >
        {usage ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <UsageTile icon={<Scan className="w-4 h-4" />} value={usage.scans_this_month} label="Scans" limit={scanLimit} />
              <UsageTile icon={<Sparkles className="w-4 h-4" />} value={usage.ai_calls_this_month} label="AI Calls" />
              <UsageTile icon={<FileText className="w-4 h-4" />} value={usage.pdf_reports_this_month} label="PDF Reports" />
              <UsageTile icon={<BarChart3 className="w-4 h-4" />} value={usage.total_scans} label="All-time Scans" />
            </div>

            {/* Progress bar for scan limit */}
            {scanPercent !== null && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Monthly scan usage</span>
                  <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
                    {usage.scans_this_month} / {scanLimit}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      scanPercent >= 100 ? 'bg-red-500' : scanPercent > 75 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${scanPercent}%` }}
                  />
                </div>
                {scanPercent >= 100 && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Scan limit reached — upgrade to continue
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
            Loading usage data...
          </div>
        )}
      </Section>

      {/* ===== SECTION: Company & Branding ===== */}
      <Section
        title="Company & Branding"
        description="Used for white-label PDF reports. Your company name and logo appear in report headers."
        footer={
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </button>
        }
      >
        <div className="space-y-5">
          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Company Name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your consulting firm name"
              className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Displayed on PDF report headers.</p>
          </div>

          {/* Brand Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Brand Color
            </label>
            <div className="flex items-center gap-3 max-w-md">
              <input
                type="color"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="h-10 w-12 rounded-lg cursor-pointer border border-gray-300 dark:border-gray-600 bg-transparent"
              />
              <input
                type="text"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <div
                className="h-10 flex-1 rounded-lg border border-gray-200 dark:border-gray-600"
                style={{ backgroundColor: brandingColor }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Used as the accent color in PDF reports.</p>
          </div>

          {/* Company Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
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
              <div className="flex items-center gap-4 max-w-md">
                <div className="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain p-1.5" />
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Change
                  </button>
                  <button
                    onClick={handleRemoveLogo}
                    className="flex items-center gap-1 text-red-500 dark:text-red-400 hover:underline font-medium"
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
                className="max-w-md w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center hover:border-gray-400 dark:hover:border-gray-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                    <span className="text-sm text-gray-500">Uploading...</span>
                  </div>
                ) : (
                  <>
                    <Upload className="h-5 w-5 mx-auto text-gray-400 mb-1.5" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">Click to upload your logo</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, SVG, JPEG or WebP, max 2MB</p>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ===== SECTION: Notifications ===== */}
      <Section
        title="Notifications"
        description="Choose how and when you want to be notified."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between max-w-lg">
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                emailNotifications
                  ? 'bg-blue-50 dark:bg-blue-900/20'
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
                  Receive email when a scan completes or fails
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
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
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

          <div className="flex items-start gap-3 max-w-lg">
            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Scheduled Scan Alerts</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Results from scheduled scans are automatically emailed after each run
              </p>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* =================== Layout Components =================== */

function Section({
  title,
  description,
  action,
  footer,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 rounded-lg border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#111827] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {/* Content */}
      <div className="px-6 py-5">
        {children}
      </div>
      {/* Footer */}
      {footer && (
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex justify-end">
          {footer}
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{label}</td>
      <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-white">{value}</td>
    </tr>
  );
}

function UsageTile({
  icon,
  value,
  label,
  limit,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  limit?: number | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
      <div className="text-gray-400 dark:text-gray-500 flex justify-center mb-1">{icon}</div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">
        {value}
        {limit && <span className="text-sm font-normal text-gray-400 dark:text-gray-500">/{limit}</span>}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
