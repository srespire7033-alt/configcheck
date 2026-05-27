import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Paths that anyone (signed in or not) can hit.
// - Legal: privacy / terms / DPA / security must be readable without an account
//   for GDPR/CCPA compliance and so prospects can review before signup.
// - Marketing: pricing / demo / changelog are sales surfaces — locking them
//   behind auth kills conversion.
// - Crawler files: robots.txt + sitemap.xml — search engines never sign in.
// - OAuth callbacks: Salesforce / Supabase redirect here pre-session.
const PUBLIC_EXACT = new Set([
  '/',
  '/privacy',
  '/terms',
  '/security',
  '/dpa',
  '/pricing',
  '/changelog',
  '/demo',
  '/robots.txt',
  '/sitemap.xml',
]);
const PUBLIC_PREFIX = [
  '/api/salesforce/callback',
  '/auth/callback',
  '/login',  // includes /login subroutes (forgot-password, etc.)
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIX) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Truly public — no session check, no redirects. Legal pages, marketing,
  // crawler files, OAuth callbacks. /login is handled separately below
  // because a signed-in user there should bounce to /dashboard.
  if (isPublicPath(pathname) && !pathname.startsWith('/login')) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in user visiting /login → redirect to dashboard
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Anonymous user on /login → let them through (it's a public route from
  // here on; nothing to do).
  if (!user && pathname.startsWith('/login')) {
    return supabaseResponse;
  }

  // Not logged in on a protected route → bounce to /login.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Onboarding redirect: logged-in user who hasn't completed onboarding
  if (user && !request.nextUrl.pathname.startsWith('/onboarding') && !request.nextUrl.pathname.startsWith('/api/')) {
    let onboardingDone = request.cookies.get('onboarding_completed')?.value === 'true';

    // Cookie missing (cleared cache, new device) — check DB as fallback
    if (!onboardingDone) {
      const { data: profile } = await supabase
        .from('users')
        .select('onboarding_completed')
        .eq('id', user.id)
        .single();

      if (profile?.onboarding_completed) {
        onboardingDone = true;
        // Restore the cookie so we don't hit DB on every request
        supabaseResponse.cookies.set('onboarding_completed', 'true', {
          path: '/',
          maxAge: 31536000,
          sameSite: 'lax',
        });
      }
    }

    if (!onboardingDone) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }
  }

  // Already completed onboarding but visiting /onboarding → redirect to dashboard
  if (user && request.nextUrl.pathname.startsWith('/onboarding')) {
    let onboardingDone = request.cookies.get('onboarding_completed')?.value === 'true';

    if (!onboardingDone) {
      const { data: profile } = await supabase
        .from('users')
        .select('onboarding_completed')
        .eq('id', user.id)
        .single();

      onboardingDone = !!profile?.onboarding_completed;
    }

    if (onboardingDone) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/(?!orgs|scans|issues|reports|ai)).*)'],
};
