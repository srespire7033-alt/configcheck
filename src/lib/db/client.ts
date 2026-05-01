import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Browser client (used in React components)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server client with service role (used in API routes - bypasses RLS).
// CRITICAL: Next.js 14 patches global fetch() to cache by default even inside
// `force-dynamic` routes. Supabase-js uses fetch() to talk to PostgREST, so
// without `cache: 'no-store'` here a stale row read by one request will be
// served indefinitely to subsequent requests on the same Vercel function
// instance — even after a successful PUT updates the database. This was the
// root cause of the "phone disappears after save" bug.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        fetch: (input, init) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  );
}
