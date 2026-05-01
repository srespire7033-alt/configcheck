'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save, LogOut, Upload, X,
  Bell, BellOff, CheckCircle2, Zap,
  Clock, ExternalLink, User, Palette,
  CreditCard, Phone, MapPin, Briefcase, Globe, Mail,
  AlertTriangle, Download, Trash2, AlertCircle, ShieldCheck
} from 'lucide-react';
import { createClient } from '@/lib/db/client';
import { LoadingScreen } from '@/components/ui/loading-screen';

type SettingsTab = 'account' | 'plan' | 'branding' | 'notifications' | 'privacy';

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'plan', label: 'Plan & Billing', icon: CreditCard },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
];

const PLAN_INFO: Record<string, {
  label: string;
  price: string;
  priceNote: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
  features: string[];
}> = {
  free: {
    label: 'Free',
    price: '$0',
    priceNote: 'forever',
    color: 'text-gray-700 dark:text-gray-300',
    bg: 'bg-gray-50 dark:bg-gray-800',
    border: 'border-gray-200 dark:border-gray-700',
    dot: 'bg-gray-400',
    features: ['1 Salesforce org', '5 scans per month', '100+ health checks', 'AI fix suggestions', 'Basic PDF report'],
  },
  pro: {
    label: 'Pro',
    price: '$49',
    priceNote: 'per month',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    dot: 'bg-blue-500',
    features: ['5 Salesforce orgs', 'Unlimited scans', 'White-label PDF reports', 'Scan comparison & history', 'AI remediation plans', 'Priority support'],
  },
  enterprise: {
    label: 'Enterprise',
    price: 'Custom',
    priceNote: 'talk to us',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    dot: 'bg-purple-500',
    features: ['Unlimited orgs', 'Unlimited scans', 'Custom branding', 'API access', 'SSO / SAML', 'Dedicated support'],
  },
};

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
];

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');

  // Profile fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [location, setLocation] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [companyName, setCompanyName] = useState('');
  const [brandingColor, setBrandingColor] = useState('#1B5E96');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('free');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [notificationEmails, setNotificationEmails] = useState<string[]>([]);
  const [newNotifEmail, setNewNotifEmail] = useState('');
  const [notifEmailError, setNotifEmailError] = useState('');
  const [savingNotifEmails, setSavingNotifEmails] = useState(false);

  // Save states per section
  const [savingAccount, setSavingAccount] = useState(false);
  const [savedAccount, setSavedAccount] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savedBranding, setSavedBranding] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Danger zone states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [usage, setUsage] = useState<{
    total_scans: number;
    scans_this_month: number;
    ai_calls_this_month: number;
    pdf_reports_this_month: number;
    connected_orgs: number;
    is_admin?: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setFullName(data.full_name || '');
          setPhone(data.phone || '');
          setJobTitle(data.job_title || '');
          setLocation(data.location || '');
          setTimezone(data.timezone || 'Asia/Kolkata');
          setCompanyName(data.company_name || '');
          setBrandingColor(data.report_branding_color || '#1B5E96');
          setLogoUrl(data.company_logo_url || null);
          setEmail(data.email || '');
          setPlan(data.plan || 'free');
          setCreatedAt(data.created_at || null);
          setEmailNotifications(data.email_notifications_enabled !== false);
          setNotificationEmails(data.notification_emails || []);
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
    setLogoError(null);
    const allowedTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setLogoError('Only PNG, SVG, JPEG, and WebP files are allowed.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError(`File must be under 2 MB (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch('/api/auth/logo', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        setLogoUrl(data.url);
      } else {
        const err = await res.json().catch(() => ({}));
        setLogoError(err.error || 'Upload failed.');
      }
    } catch {
      setLogoError('Upload failed.');
    } finally { setUploading(false); }
  }

  async function handleRemoveLogo() {
    setLogoUrl(null);
    await fetch('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_logo_url: null }),
    });
  }

  async function addNotificationEmail() {
    const trimmed = newNotifEmail.trim().toLowerCase();
    if (!trimmed) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setNotifEmailError('Please enter a valid email address');
      return;
    }
    if (trimmed === email.toLowerCase()) {
      setNotifEmailError('This is already your account email');
      return;
    }
    if (notificationEmails.includes(trimmed)) {
      setNotifEmailError('This email is already added');
      return;
    }
    if (notificationEmails.length >= 5) {
      setNotifEmailError('Maximum 5 emails allowed');
      return;
    }

    const updated = [...notificationEmails, trimmed];
    setSavingNotifEmails(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_emails: updated }),
      });
      if (res.ok) {
        setNotificationEmails(updated);
        setNewNotifEmail('');
        setNotifEmailError('');
      } else {
        const data = await res.json();
        setNotifEmailError(data.error || 'Failed to add email');
      }
    } catch {
      setNotifEmailError('Failed to save');
    } finally {
      setSavingNotifEmails(false);
    }
  }

  async function saveAccount() {
    setSavingAccount(true);
    try {
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, phone, job_title: jobTitle, location, timezone }),
      });
      setSavedAccount(true);
      setTimeout(() => setSavedAccount(false), 3000);
    } catch {
      alert('Failed to save account settings. Please try again.');
    } finally { setSavingAccount(false); }
  }

  async function saveBranding() {
    setSavingBranding(true);
    try {
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: companyName, report_branding_color: brandingColor }),
      });
      setSavedBranding(true);
      setTimeout(() => setSavedBranding(false), 3000);
    } catch {
      alert('Failed to save branding settings. Please try again.');
    } finally { setSavingBranding(false); }
  }

  async function handleExportData() {
    setIsExporting(true);
    try {
      const res = await fetch('/api/account/export');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        alert(err.error || 'Export failed');
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `configcheck-data-export-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDeleteAccount() {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
      });
      if (res.ok) {
        router.push('/login');
      } else {
        const err = await res.json().catch(() => ({ error: 'Deletion failed' }));
        alert(err.error || 'Account deletion failed. Please try again.');
      }
    } catch {
      alert('Account deletion failed. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading) return <LoadingScreen />;

  const planInfo = PLAN_INFO[plan] || PLAN_INFO.free;
  const scanLimit = plan === 'free' ? 5 : null; // Pro & Enterprise = unlimited
  const aiLimit = plan === 'free' ? 5 : null;
  const pdfLimit = plan === 'free' ? 5 : null;
  const orgLimit = plan === 'free' ? 1 : plan === 'pro' ? 5 : null;

  // Reset date: 1st of next month
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const resetDateStr = resetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const daysUntilReset = Math.ceil((resetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ===== LEFT SIDEBAR ===== */}
        <nav className="lg:w-56 flex-shrink-0">
          <div className="lg:sticky lg:top-20 space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 shadow-sm border border-blue-100 dark:border-blue-800/50'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}`} />
                  {tab.label}
                </button>
              );
            })}

            {/* Sign out at bottom */}
            <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </nav>

        {/* ===== RIGHT CONTENT ===== */}
        <div className="flex-1 min-w-0">

          {/* ==================== ACCOUNT TAB ==================== */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <SectionCard title="Profile" description="Your personal information. This is used across the platform.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <FormField label="Full Name" icon={<User className="w-4 h-4" />}>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Doe"
                      className="form-input"
                    />
                  </FormField>
                  <FormField label="Email Address" icon={<Mail className="w-4 h-4" />}>
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        value={email}
                        disabled
                        className="form-input opacity-60 cursor-not-allowed"
                      />
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> Verified
                      </span>
                    </div>
                  </FormField>
                  <FormField label="Phone Number" icon={<Phone className="w-4 h-4" />}>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="form-input"
                    />
                  </FormField>
                  <FormField label="Job Title" icon={<Briefcase className="w-4 h-4" />}>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="Salesforce Revenue Cloud Consultant"
                      className="form-input"
                    />
                  </FormField>
                  <FormField label="Location" icon={<MapPin className="w-4 h-4" />}>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Vadodara, India"
                      className="form-input"
                    />
                  </FormField>
                  <FormField label="Timezone" icon={<Globe className="w-4 h-4" />}>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="form-input"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
                {memberSince && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">Member since {memberSince}</p>
                )}
                <SaveBar saving={savingAccount} saved={savedAccount} onSave={saveAccount} />
              </SectionCard>

            </div>
          )}

          {/* ==================== PRIVACY TAB ====================
              Destructive actions (export, delete) live here so they're
              not one mis-click away from the Profile form. */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <SectionCard title="Your Data" description="Export everything we have about you, or remove your account.">
                <div className="space-y-4">
                  {/* Export Data */}
                  <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <Download className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Export My Data</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Download a JSON file containing all your account data — orgs, scans, issues, schedules, and profile.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleExportData}
                      disabled={isExporting}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-4"
                    >
                      {isExporting ? (
                        <>
                          <div className="animate-spin h-3.5 w-3.5 border-2 border-gray-500 border-t-transparent rounded-full" />
                          Exporting...
                        </>
                      ) : (
                        'Export'
                      )}
                    </button>
                  </div>

                  {/* Delete Account */}
                  <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                        <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">Delete My Account</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Permanently delete your account, all scan history, and disconnect every Salesforce org.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); }}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all bg-red-600 text-white hover:bg-red-700 flex-shrink-0 ml-4"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ==================== PLAN TAB ==================== */}
          {activeTab === 'plan' && (
            <div className="space-y-6">
              <SectionCard title="Current Plan" description="Manage your subscription and view plan details.">
                {/* Active plan card */}
                <div className={`flex items-center justify-between p-5 rounded-xl border-2 ${planInfo.border} ${planInfo.bg} shadow-sm`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm text-xl ${
                      plan === 'enterprise' ? 'bg-purple-600 text-white' :
                      plan === 'pro' ? 'bg-blue-600 text-white' :
                      'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      {plan === 'enterprise' ? '👑' : plan === 'pro' ? '⚡' : '🎁'}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h4 className={`text-lg font-bold ${planInfo.color}`}>{planInfo.label}</h4>
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{planInfo.price}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{planInfo.priceNote}</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {plan === 'free' ? 'Get started with basic features' : plan === 'pro' ? 'For growing consulting firms' : 'Custom plan for your team'}
                      </p>
                    </div>
                  </div>
                  <a
                    href="/#pricing"
                    className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    {plan === 'free' ? 'Upgrade' : 'Manage Plan'}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </SectionCard>

              {/* Usage limits with progress bars. Connected Orgs is a
                  concurrent (not monthly) limit — handled with isConcurrent
                  so the UsageBar drops the "resets on" copy. Admins get
                  an "Admin — unlimited" pill instead of the X/Y bar. */}
              <SectionCard title="Plan Usage" description={usage?.is_admin ? 'Admin — quotas bypassed' : `Resets on ${resetDateStr} (${daysUntilReset} days)`}>
                <div className="space-y-5">
                  <UsageBar
                    label="Scans"
                    description={scanLimit ? `Up to ${scanLimit} scans per month` : 'Unlimited scans'}
                    used={usage?.scans_this_month ?? 0}
                    limit={scanLimit}
                    color="blue"
                    resetDate={resetDateStr}
                    isAdmin={usage?.is_admin}
                  />
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  <UsageBar
                    label="AI Remediation Calls"
                    description={aiLimit ? `Up to ${aiLimit} AI calls per month` : 'Unlimited AI calls'}
                    used={usage?.ai_calls_this_month ?? 0}
                    limit={aiLimit}
                    color="purple"
                    resetDate={resetDateStr}
                    isAdmin={usage?.is_admin}
                  />
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  <UsageBar
                    label="PDF Reports"
                    description={pdfLimit ? `Up to ${pdfLimit} reports per month` : 'Unlimited reports'}
                    used={usage?.pdf_reports_this_month ?? 0}
                    limit={pdfLimit}
                    color="green"
                    resetDate={resetDateStr}
                    isAdmin={usage?.is_admin}
                  />
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  <UsageBar
                    label="Connected Orgs"
                    description={orgLimit ? `Up to ${orgLimit} Salesforce org${orgLimit === 1 ? '' : 's'} at a time` : 'Unlimited Salesforce orgs'}
                    used={usage?.connected_orgs ?? 0}
                    limit={orgLimit}
                    color="blue"
                    resetDate={resetDateStr}
                    isAdmin={usage?.is_admin}
                    isConcurrent
                  />
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">All-time Scans</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Total scans run across all orgs</p>
                    </div>
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{usage?.total_scans ?? 0}</span>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Plan Features" description="What's included in your plan.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {planInfo.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{feature}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ==================== BRANDING TAB ==================== */}
          {activeTab === 'branding' && (
            <div className="space-y-6">
              <SectionCard title="Company & Branding" description="Customize white-label PDF reports with your brand identity.">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8">
                  {/* Form column */}
                  <div className="space-y-5">
                    <FormField label="Company Name">
                      <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Your consulting firm name"
                        className="form-input"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Displayed on PDF report headers and footers.</p>
                    </FormField>

                    <FormField label="Brand Color">
                      <div className="flex items-center gap-3">
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
                          className="h-10 w-20 rounded-lg border border-gray-200 dark:border-gray-600"
                          style={{ backgroundColor: brandingColor }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Used as the accent color in PDF reports.</p>
                      <ContrastWarning color={brandingColor} />
                    </FormField>

                    <FormField label="Company Logo">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/svg+xml,image/jpeg,image/webp"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      {logoUrl ? (
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain p-1.5" />
                          </div>
                          <div className="flex gap-3 text-sm">
                            <button onClick={() => fileInputRef.current?.click()} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                              Change
                            </button>
                            <button onClick={handleRemoveLogo} className="flex items-center gap-1 text-red-500 dark:text-red-400 hover:underline font-medium">
                              <X className="h-3 w-3" /> Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center hover:border-gray-400 dark:hover:border-gray-500 transition-colors cursor-pointer disabled:opacity-50"
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
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, SVG, JPEG or WebP, max 2 MB · recommended 200×60 px</p>
                            </>
                          )}
                        </button>
                      )}
                      {logoError && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-2 flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          <span>{logoError}</span>
                        </p>
                      )}
                    </FormField>
                  </div>

                  {/* Preview column — sticky so it stays in view as the user
                      scrolls the form. Updates live as fields change. */}
                  <div className="lg:sticky lg:top-6 self-start w-full">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">PDF preview</p>
                    <BrandingPreview
                      companyName={companyName}
                      brandColor={brandingColor}
                      logoUrl={logoUrl}
                    />
                  </div>
                </div>
                <SaveBar saving={savingBranding} saved={savedBranding} onSave={saveBranding} />
              </SectionCard>
            </div>
          )}

          {/* ==================== NOTIFICATIONS TAB ==================== */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <SectionCard title="Notifications" description="Control how and when you receive updates.">
                <div className="space-y-4 max-w-lg">
                  <NotificationRow
                    icon={<Bell className="w-4 h-4" />}
                    activeIcon={<Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                    inactiveIcon={<BellOff className="w-4 h-4 text-gray-400" />}
                    title="Email Notifications"
                    description="Get notified when scans complete, fail, or find critical issues"
                    enabled={emailNotifications}
                    onToggle={async () => {
                      const newVal = !emailNotifications;
                      setEmailNotifications(newVal);
                      await fetch('/api/auth/me', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email_notifications_enabled: newVal }),
                      });
                    }}
                  />
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  <div className="flex items-start gap-3 py-1">
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
              </SectionCard>

              {/* Notification Recipients */}
              <SectionCard title="Notification Recipients" description="Add up to 5 email addresses to receive scan notifications. Your account email always receives notifications.">
                <div className="space-y-4 max-w-lg">
                  {/* Account email (always included) */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-300 flex-1">{email}</span>
                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">Account</span>
                  </div>

                  {/* Additional emails list */}
                  {notificationEmails.map((ne, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 group">
                      <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{ne}</span>
                      <button
                        onClick={async () => {
                          const updated = notificationEmails.filter((_, i) => i !== idx);
                          setNotificationEmails(updated);
                          setSavingNotifEmails(true);
                          await fetch('/api/auth/me', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ notification_emails: updated }),
                          });
                          setSavingNotifEmails(false);
                        }}
                        className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Add new email */}
                  {notificationEmails.length < 5 && (
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          placeholder="colleague@company.com"
                          value={newNotifEmail}
                          onChange={(e) => { setNewNotifEmail(e.target.value); setNotifEmailError(''); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addNotificationEmail();
                            }
                          }}
                          className="form-input flex-1"
                        />
                        <button
                          onClick={addNotificationEmail}
                          disabled={!newNotifEmail || savingNotifEmails}
                          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                        >
                          {savingNotifEmails ? '...' : 'Add'}
                        </button>
                      </div>
                      {notifEmailError && (
                        <p className="text-xs text-red-500 mt-1.5">{notifEmailError}</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        {5 - notificationEmails.length} of 5 slots remaining
                      </p>
                    </div>
                  )}
                  {notificationEmails.length >= 5 && (
                    <p className="text-xs text-amber-500">Maximum 5 additional emails reached. Remove one to add another.</p>
                  )}
                </div>
              </SectionCard>
            </div>
          )}
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />
          {/* Modal */}
          <div className="relative w-full max-w-md bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Red header */}
            <div className="px-6 py-5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Delete Account</h3>
                  <p className="text-sm text-red-600/70 dark:text-red-400/60">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                This will permanently delete your account and <strong>ALL</strong> associated data including:
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5 pl-1">
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">&#x2022;</span>
                  Connected Salesforce orgs
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">&#x2022;</span>
                  Scan history
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">&#x2022;</span>
                  Issues, reports, and schedules
                </li>
              </ul>

              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Type <span className="font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded text-xs">DELETE MY ACCOUNT</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="form-input"
                  disabled={isDeleting}
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE MY ACCOUNT' || isDeleting}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete My Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global styles for form inputs */}
      <style jsx global>{`
        .form-input {
          width: 100%;
          padding: 0.625rem 0.875rem;
          border: 1px solid;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          line-height: 1.25rem;
          transition: all 0.15s ease;
          border-color: rgb(209 213 219);
          background-color: rgb(249 250 251);
          color: rgb(17 24 39);
        }
        .dark .form-input {
          border-color: rgb(75 85 99);
          background-color: rgba(17, 24, 39, 0.8);
          color: white;
        }
        .form-input:hover {
          border-color: rgb(156 163 175);
        }
        .dark .form-input:hover {
          border-color: rgb(107 114 128);
        }
        .form-input:focus {
          outline: none;
          border-color: rgb(59 130 246);
          background-color: white;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .dark .form-input:focus {
          background-color: rgb(17, 24, 39);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
        }
        .form-input::placeholder {
          color: rgb(156 163 175);
        }
        .dark .form-input::placeholder {
          color: rgb(107 114 128);
        }
      `}</style>
    </div>
  );
}

/* =================== Reusable Components =================== */

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700/80">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function FormField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {icon && <span className="text-gray-400">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

function SaveBar({
  saving,
  saved,
  onSave,
}: {
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end pt-2">
      <button
        onClick={onSave}
        disabled={saving}
        className={`flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg transition-all shadow-sm ${
          saved
            ? 'bg-green-600 text-white shadow-green-200 dark:shadow-green-900/30'
            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200 dark:shadow-blue-900/30'
        } disabled:opacity-50`}
      >
        {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  );
}

function UsageBar({
  label,
  description,
  used,
  limit,
  color,
  resetDate,
  isAdmin = false,
  isConcurrent = false,
}: {
  label: string;
  description: string;
  used: number;
  limit: number | null;
  color: 'blue' | 'purple' | 'green';
  resetDate: string;
  // Admins bypass quota — render an "Admin — unlimited" pill rather than
  // an X/Y bar that misleadingly shows "over limit" because admins don't
  // count usage.
  isAdmin?: boolean;
  // Concurrent (non-monthly) limit — Connected Orgs is N at a time, not
  // N per month. Hides "resets on" copy; over-limit message points at
  // disconnect rather than waiting for a reset.
  isConcurrent?: boolean;
}) {
  const isUnlimited = limit === null || isAdmin;
  const cappedPercent = limit ? Math.min((used / limit) * 100, 100) : 0;
  const isOverLimit = !isAdmin && limit !== null && used > limit;
  const isAtLimit = !isAdmin && limit !== null && used >= limit;
  const isNearLimit = !isAdmin && limit !== null && cappedPercent > 75 && !isAtLimit;

  const barColor = isOverLimit || isAtLimit
    ? 'bg-red-500'
    : isNearLimit
      ? 'bg-amber-500'
      : color === 'blue' ? 'bg-blue-500' : color === 'purple' ? 'bg-purple-500' : 'bg-green-500';

  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>
        </div>
        <span className="text-sm font-mono text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0 flex items-center gap-2">
          {isAdmin ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-sans">
              Admin · {used}
            </span>
          ) : limit === null ? (
            <>{used} used</>
          ) : (
            <>
              {used} <span className="text-gray-300 dark:text-gray-600">/</span> {limit}
              {isOverLimit && (
                <span className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                  +{used - limit} over
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {!isUnlimited && limit !== null && (
        <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.max(cappedPercent, used > 0 ? 2 : 0)}%` }}
          />
        </div>
      )}

      {isAtLimit && !isAdmin && (
        <div className="flex items-center justify-between gap-3 p-3 bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/40 rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">
              {isConcurrent
                ? `${label} limit reached — disconnect an org to free a slot, or upgrade.`
                : `${label} limit reached — resets ${resetDate}`}
            </p>
          </div>
          <a href="/#pricing" className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold flex-shrink-0">
            Upgrade plan
          </a>
        </div>
      )}
      {isNearLimit && !isAdmin && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {limit! - used} remaining{isConcurrent ? '' : ` — resets ${resetDate}`}
        </p>
      )}
    </div>
  );
}

function NotificationRow({
  activeIcon,
  inactiveIcon,
  title,
  description,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          enabled ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-gray-100 dark:bg-gray-800'
        }`}>
          {enabled ? activeIcon : inactiveIcon}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
          enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}

// ─── Branding live preview ──────────────────────────────────────────
// Mirrors the white-label PDF report header: logo (or company name as
// fallback), brand-color accent bar, sample title, footer with
// company name. Updates live as the user edits.
function BrandingPreview({
  companyName,
  brandColor,
  logoUrl,
}: {
  companyName: string;
  brandColor: string;
  logoUrl: string | null;
}) {
  const displayName = companyName.trim() || 'Your Company';
  const textOnBrand = textColorForBackground(brandColor);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white shadow-sm overflow-hidden">
      {/* Aspect ratio mimics letter-size PDF page (8.5×11) */}
      <div className="relative aspect-[8.5/11] bg-white text-gray-900 flex flex-col">
        {/* Header bar with logo + accent strip */}
        <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-gray-100">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-8 max-w-[120px] object-contain" />
          ) : (
            <div className="text-sm font-bold text-gray-900 truncate">{displayName}</div>
          )}
          <div className="ml-auto text-[9px] font-mono text-gray-400 tracking-wider uppercase">Audit Report</div>
        </div>
        <div className="h-1" style={{ backgroundColor: brandColor }} />

        {/* Body */}
        <div className="px-5 pt-4 flex-1 space-y-3">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-gray-500">Configuration Health</p>
            <p className="text-base font-bold text-gray-900 mt-0.5">{displayName} — CPQ Audit</p>
          </div>

          {/* Brand-color score chip */}
          <div className="inline-flex items-center gap-2 rounded-md px-2.5 py-1" style={{ backgroundColor: brandColor, color: textOnBrand }}>
            <span className="text-[10px] font-semibold tracking-wide">Score</span>
            <span className="text-sm font-bold">87 / 100</span>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="h-1.5 w-full bg-gray-100 rounded" />
            <div className="h-1.5 w-11/12 bg-gray-100 rounded" />
            <div className="h-1.5 w-10/12 bg-gray-100 rounded" />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="rounded border border-gray-200 p-2">
              <div className="h-1 w-10 rounded mb-1.5" style={{ backgroundColor: brandColor }} />
              <p className="text-[9px] text-gray-500 uppercase">Critical</p>
              <p className="text-sm font-bold">3</p>
            </div>
            <div className="rounded border border-gray-200 p-2">
              <div className="h-1 w-10 rounded mb-1.5" style={{ backgroundColor: brandColor, opacity: 0.5 }} />
              <p className="text-[9px] text-gray-500 uppercase">Warning</p>
              <p className="text-sm font-bold">9</p>
            </div>
            <div className="rounded border border-gray-200 p-2">
              <div className="h-1 w-10 rounded mb-1.5 bg-gray-300" />
              <p className="text-[9px] text-gray-500 uppercase">Info</p>
              <p className="text-sm font-bold">2</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-2.5 flex items-center justify-between text-[9px] text-gray-500">
          <span>{displayName}</span>
          <span style={{ color: brandColor, fontWeight: 600 }}>configcheck.app</span>
          <span>Page 1 of 12</span>
        </div>
      </div>
    </div>
  );
}

// Pick black or white text for legibility against an arbitrary
// background color. Uses relative-luminance per WCAG.
function textColorForBackground(hex: string): string {
  const lum = relativeLuminance(hex);
  return lum > 0.5 ? '#0f172a' : '#ffffff';
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

// Warn when the chosen brand color won't have enough contrast against
// either pure white or near-black text — readers won't be able to read
// score chips and accent text on the PDF. WCAG AA = 4.5:1 for normal
// text, 3:1 for large/bold.
function ContrastWarning({ color }: { color: string }) {
  if (!/^#?[a-f\d]{6}$/i.test(color.trim())) return null;
  const vsWhite = contrastRatio(color, '#ffffff');
  const vsDark = contrastRatio(color, '#0f172a');
  // The PDF uses brand color as a fill behind white text in chips, so
  // the relevant check is contrast against #ffffff.
  if (vsWhite >= 3) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-start gap-1.5">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>
        Low contrast against white text (ratio {vsWhite.toFixed(1)}:1, WCAG AA needs ≥3:1).
        White-on-{color} text in PDF chips may be hard to read. Consider a darker shade — your color contrasts {vsDark.toFixed(1)}:1 with dark text.
      </span>
    </p>
  );
}
