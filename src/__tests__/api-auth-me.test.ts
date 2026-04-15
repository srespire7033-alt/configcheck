import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/get-user', () => ({
  getAuthUser: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  createServiceClient: vi.fn(),
}));

import { getAuthUser } from '@/lib/auth/get-user';
import { createServiceClient } from '@/lib/db/client';
import { GET, PUT } from '@/app/api/auth/me/route';

const mockUser = {
  id: 'user-123',
  email: 'maulik@example.com',
};

const mockProfile = {
  id: 'user-123',
  email: 'maulik@example.com',
  company_name: 'Acme Corp',
  company_logo_url: 'https://example.com/logo.png',
  report_branding_color: '#3B82F6',
  plan: 'pro',
  created_at: '2026-01-01T00:00:00Z',
};

function makeGetRequest() {
  return new NextRequest(new URL('http://localhost:3000/api/auth/me'));
}

function makePutRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL('http://localhost:3000/api/auth/me'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/auth/me', () => {
  let mockSingle: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle = vi.fn();
    mockEq = vi.fn().mockReturnValue({ single: mockSingle });
    mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom = vi.fn().mockReturnValue({ select: mockSelect, update: mockUpdate });
    (createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });
  });

  describe('GET', () => {
    it('returns 401 when not authenticated', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await GET(makeGetRequest());
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('returns user profile on success', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: mockProfile, error: null });

      const res = await GET(makeGetRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual(mockProfile);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith(
        'id, email, full_name, phone, job_title, location, company_name, company_logo_url, report_branding_color, timezone, plan, is_admin, email_notifications_enabled, notification_emails, created_at'
      );
      expect(mockEq).toHaveBeenCalledWith('id', 'user-123');
    });

    it('returns 404 when user not found in DB', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: null, error: null });

      const res = await GET(makeGetRequest());
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('User not found');
    });

    it('returns 404 when DB returns an error', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      const res = await GET(makeGetRequest());
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('User not found');
    });
  });

  describe('PUT', () => {
    it('returns 401 when not authenticated', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await PUT(makePutRequest({ company_name: 'New Corp' }));
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 400 when no fields provided', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const res = await PUT(makePutRequest({}));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('No fields to update');
    });

    it('updates company_name successfully', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockEq.mockResolvedValue({ error: null });

      const res = await PUT(makePutRequest({ company_name: 'New Corp' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockUpdate).toHaveBeenCalledWith({ company_name: 'New Corp' });
      expect(mockEq).toHaveBeenCalledWith('id', 'user-123');
    });

    it('updates branding color successfully', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockEq.mockResolvedValue({ error: null });

      const res = await PUT(makePutRequest({ report_branding_color: '#FF0000' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({ report_branding_color: '#FF0000' });
    });

    it('updates logo URL successfully', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockEq.mockResolvedValue({ error: null });

      const res = await PUT(makePutRequest({ company_logo_url: 'https://example.com/new-logo.png' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({ company_logo_url: 'https://example.com/new-logo.png' });
    });

    it('updates multiple fields at once', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockEq.mockResolvedValue({ error: null });

      const updates = {
        company_name: 'Updated Corp',
        report_branding_color: '#00FF00',
        company_logo_url: 'https://example.com/updated-logo.png',
      };

      const res = await PUT(makePutRequest(updates));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(updates);
    });

    it('returns 500 on DB error', async () => {
      (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      mockEq.mockResolvedValue({ error: { message: 'Database connection failed' } });

      const res = await PUT(makePutRequest({ company_name: 'Fail Corp' }));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to update profile');
    });
  });
});
