import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Extract authenticated user from request cookies.
 * Returns null if not authenticated.
 */
export async function getAuthUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // No-op for read-only usage in API routes
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
