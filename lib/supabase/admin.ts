import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — **SERVER ONLY**.
 *
 * ⚠️  This client bypasses RLS. It must NEVER be imported in a Client
 * Component or any code that ships to the browser. The
 * SUPABASE_SERVICE_ROLE_KEY must never be prefixed with NEXT_PUBLIC_.
 *
 * Used for privileged server-side operations:
 *   - Creating/inviting admin users (auth.admin.createUser)
 *   - Querying admin tables behind RLS
 *   - Audit logging
 *   - Any operation that requires elevated privileges
 *
 * All calls using this client must be gated behind requireAdmin() /
 * requirePermission() checks in the API route or Server Action.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}