import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Browser client (used in React components)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server client with service role (used in API routes - bypasses RLS)
// Accepts options to disable PostgREST caching for read-after-write scenarios
export function createServiceClient(options?: { noCache?: boolean }) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(options?.noCache ? {
        global: {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        },
      } : {}),
    }
  );
}
