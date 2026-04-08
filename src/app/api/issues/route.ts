import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/issues?scanId=xxx or /api/issues?issueId=xxx
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scanId = request.nextUrl.searchParams.get('scanId');
  const issueId = request.nextUrl.searchParams.get('issueId');
  const severity = request.nextUrl.searchParams.get('severity');
  const category = request.nextUrl.searchParams.get('category');
  const status = request.nextUrl.searchParams.get('status');

  const supabase = createServiceClient();

  // Single issue
  if (issueId) {
    const { data, error } = await supabase
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  // Issues for a scan
  if (scanId) {
    let query = supabase
      .from('issues')
      .select('*')
      .eq('scan_id', scanId)
      .order('severity', { ascending: true })
      .order('category', { ascending: true });

    if (severity && severity !== 'all') {
      query = query.eq('severity', severity);
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 });
    }
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'scanId or issueId required' }, { status: 400 });
}

/**
 * PUT /api/issues
 * Update issue status or notes
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId, status, notes } = await request.json();

    if (!issueId) {
      return NextResponse.json({ error: 'issueId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const updates: Record<string, unknown> = {};

    if (status) {
      updates.status = status;
      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
      }
    }
    if (notes !== undefined) {
      updates.notes = notes;
    }

    const { error } = await supabase
      .from('issues')
      .update(updates)
      .eq('id', issueId);

    if (error) {
      return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
