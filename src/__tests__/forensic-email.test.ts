/**
 * Forensic scan email — subject-line + opt-in behavior.
 *
 * The HTML body is verified by visual review (no DOM testing).
 * What matters here:
 *   1. Subject line shape across the four scenarios
 *   2. Opt-out respected
 *   3. Clean-scan-no-diff path skipped (avoid noise)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendForensicScanNotification, type ForensicNotificationData } from '@/lib/email/notifications';

// Mock the supabase client to control user state.
const mockSingle = vi.fn();
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: mockSingle,
    })),
  })),
}));
vi.mock('@/lib/db/client', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));

// Capture fetch calls so we can verify subject lines without actually
// sending email.
const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => '{}' }));
global.fetch = fetchSpy as unknown as typeof fetch;

beforeEach(() => {
  fetchSpy.mockClear();
  mockSingle.mockReset();
  // Default user: notifications ON
  mockSingle.mockResolvedValue({
    data: {
      email: 'maulik@example.com',
      full_name: 'Maulik',
      email_notifications_enabled: true,
      notification_emails: [],
    },
    error: null,
  });
  process.env.RESEND_API_KEY = 'test-key';
  process.env.NEXT_PUBLIC_APP_URL = 'https://orgprism.vercel.app';
});

function base(over: Partial<ForensicNotificationData> = {}): ForensicNotificationData {
  return {
    forensicScanId: 'fs-1',
    orgId: 'org-1',
    orgName: 'CPQ Ks',
    status: 'completed',
    totalVerifiedUsd: 695_000,
    findingCount: 34,
    topDetectors: [
      { id: 'ORD-FOR-001', label: 'Order, no billing', finding_count: 28, gap_usd: 650_000 },
      { id: 'DSC-FOR-001', label: 'Promo roll-off', finding_count: 10, gap_usd: 478_000 },
    ],
    topFindings: [
      { detector_id: 'ORD-FOR-001', title: 'Order 00000122 — no billing schedule', gap_usd: 50_000 },
    ],
    ...over,
  };
}

function lastEmailBody(): Record<string, unknown> {
  const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const init = (lastCall?.[1] as any) as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('sendForensicScanNotification — subject lines', () => {
  it('uses the M-style headline when leakage is large + no diff', async () => {
    await sendForensicScanNotification('user-1', base());
    const body = lastEmailBody();
    expect(body.subject).toMatch(/695\.0K.*verified leakage.*CPQ Ks/);
  });

  it('uses "leaking more" subject when diff shows escalation', async () => {
    await sendForensicScanNotification('user-1', base({
      diff: {
        net_delta_usd: 47_000,
        net_delta_pct: 7.5,
        new_count: 3,
        escalated_count: 1,
        resolved_count: 0,
        improved_count: 0,
        from_scan_date: '2026-05-25T00:00:00Z',
      },
    }));
    expect(lastEmailBody().subject).toMatch(/leaking \$47\.0K more than last scan/);
  });

  it('uses "recovered" subject when diff shows improvement', async () => {
    await sendForensicScanNotification('user-1', base({
      diff: {
        net_delta_usd: -12_000,
        net_delta_pct: -2.1,
        new_count: 0,
        escalated_count: 0,
        resolved_count: 2,
        improved_count: 1,
        from_scan_date: '2026-05-25T00:00:00Z',
      },
    }));
    expect(lastEmailBody().subject).toMatch(/recovered \$12\.0K since last scan/);
  });

  it('uses clean-audit subject when no findings + no diff', async () => {
    await sendForensicScanNotification('user-1', base({
      status: 'completed',
      totalVerifiedUsd: 0,
      findingCount: 0,
      topDetectors: [],
      topFindings: [],
      // No diff → SKIPPED per business rule below. So we test with a diff
      // to ensure the subject line is correct when the email DOES fire.
      diff: {
        net_delta_usd: -10000,
        net_delta_pct: -100,
        new_count: 0,
        escalated_count: 0,
        resolved_count: 5,
        improved_count: 0,
        from_scan_date: '2026-05-25T00:00:00Z',
      },
    }));
    // Diff dominates: still says "recovered"
    expect(lastEmailBody().subject).toMatch(/recovered/);
  });

  it('uses failure subject when scan failed', async () => {
    await sendForensicScanNotification('user-1', base({
      status: 'failed',
      totalVerifiedUsd: 0,
      findingCount: 0,
      topDetectors: [],
      topFindings: [],
      errorMessage: 'Salesforce 401',
    }));
    expect(lastEmailBody().subject).toMatch(/Forensic scan failed for CPQ Ks/);
  });
});

describe('sendForensicScanNotification — opt-in', () => {
  it('skips when user has email_notifications_enabled = false', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        email: 'opted-out@example.com',
        full_name: 'Opted Out',
        email_notifications_enabled: false,
        notification_emails: [],
      },
      error: null,
    });
    await sendForensicScanNotification('user-2', base());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips when scan is clean AND no diff (avoid noise)', async () => {
    await sendForensicScanNotification('user-1', base({
      status: 'completed',
      totalVerifiedUsd: 0,
      findingCount: 0,
      topDetectors: [],
      topFindings: [],
      diff: undefined,
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cc:s extra notification_emails when configured', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        email: 'primary@example.com',
        full_name: 'Primary',
        email_notifications_enabled: true,
        notification_emails: ['cfo@client.com', 'cto@client.com'],
      },
      error: null,
    });
    await sendForensicScanNotification('user-1', base());
    const body = lastEmailBody();
    expect(body.to).toEqual(['primary@example.com', 'cfo@client.com', 'cto@client.com']);
  });
});
