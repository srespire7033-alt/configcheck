import { NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/salesforce/client';

export async function GET() {
  try {
    const url = getAuthorizationUrl();
    return NextResponse.json({ url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
