import { createServiceClient } from '@/lib/db/client';

/**
 * Plan limits configuration.
 * null = unlimited
 */
const PLAN_LIMITS: Record<string, {
  scans: number | null;
  ai_calls: number | null;
  pdf_reports: number | null;
  orgs: number | null;
}> = {
  free: { scans: 5, ai_calls: 5, pdf_reports: 5, orgs: 1 },
  pro: { scans: null, ai_calls: null, pdf_reports: null, orgs: 5 },
  enterprise: { scans: null, ai_calls: null, pdf_reports: null, orgs: null },
};

type QuotaType = 'scans' | 'ai_calls' | 'pdf_reports' | 'orgs';

interface QuotaResult {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetDate: string;
  isAdmin: boolean;
}

/**
 * Check if a user can perform an action based on their plan limits.
 * Admins always pass. Returns quota info for UI display.
 */
export async function checkQuota(userId: string, quotaType: QuotaType): Promise<QuotaResult> {
  const supabase = createServiceClient();

  // Get user plan and admin status
  const { data: user } = await supabase
    .from('users')
    .select('plan, is_admin')
    .eq('id', userId)
    .single();

  const plan = user?.plan || 'free';
  const isAdmin = user?.is_admin === true;
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = limits[quotaType];

  // Calculate reset date (1st of next month)
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const resetDateStr = resetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Admins bypass all limits
  if (isAdmin) {
    return { allowed: true, limit, used: 0, remaining: null, resetDate: resetDateStr, isAdmin: true };
  }

  // Unlimited plan
  if (limit === null) {
    return { allowed: true, limit: null, used: 0, remaining: null, resetDate: resetDateStr, isAdmin: false };
  }

  // Count usage this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  let used = 0;

  if (quotaType === 'scans') {
    const { count } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart);
    used = count || 0;
  } else if (quotaType === 'orgs') {
    const { count } = await supabase
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    used = count || 0;
  } else {
    // AI calls and PDF reports use usage_logs
    const eventTypes = quotaType === 'ai_calls'
      ? ['ai_remediation', 'ai_scan_diff', 'ai_fix_suggestion']
      : ['pdf_report'];
    const { count } = await supabase
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('event_type', eventTypes)
      .gte('created_at', monthStart);
    used = count || 0;
  }

  const remaining = limit - used;

  return {
    allowed: used < limit,
    limit,
    used,
    remaining: Math.max(remaining, 0),
    resetDate: resetDateStr,
    isAdmin: false,
  };
}
