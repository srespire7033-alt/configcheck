import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/db/client';
import { getAuthUser } from '@/lib/auth/get-user';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { detectInstalledPackages, packageDetectionToArray } from '@/lib/salesforce/detect-packages';

/**
 * POST /api/orgs/detect-packages
 * Detect which Salesforce packages are installed in the org.
 * Caches the result on the organizations table.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId } = await request.json();
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify ownership
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Connect to Salesforce
    const { conn } = await createRefreshableConnection(org.id);

    // Detect packages
    const detected = await detectInstalledPackages(conn);
    const packagesArray = packageDetectionToArray(detected);

    // Cache on org record
    await supabase
      .from('organizations')
      .update({ installed_packages: packagesArray })
      .eq('id', organizationId);

    return NextResponse.json({
      packages: packagesArray,
      detected,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Detection failed';
    console.error('[DETECT-PACKAGES] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
