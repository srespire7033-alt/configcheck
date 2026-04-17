import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sendWelcomeEmail } from '@/lib/email/notifications';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/callback
 *
 * Handles Supabase Auth email confirmation (and magic-link / OAuth) redirects.
 * Exchanges the one-time `code` for a session, sets auth cookies, fires the
 * welcome email on first confirmation, then forwards the user into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/onboarding';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error('[AUTH CALLBACK] Exchange failed:', error?.message);
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // Fire welcome email on first email confirmation. Supabase only sends the
  // confirmation link once, so this naturally fires once per user. Fire-and-
  // forget — never block the redirect on email delivery.
  sendWelcomeEmail(data.user.id).catch((err) =>
    console.error('[AUTH CALLBACK] Welcome email error:', err)
  );

  return NextResponse.redirect(`${origin}${next}`);
}
