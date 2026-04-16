import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Skip auth check for public routes
  if (request.nextUrl.pathname === '/' || request.nextUrl.pathname.startsWith('/api/salesforce/callback')) {
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
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Not logged in and not on /login → redirect to login
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
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
