import { createClient } from "@/lib/supabase/server";

/**
 * Admin session shape returned by getAdminUser().
 */
export type AdminSession = {
  /** Supabase auth.users ID (UUID). */
  userId: string;
  /** Email from auth.users. */
  email: string;
  /** The admin_users row — null if the user is not an admin. */
  admin: {
    id: string;
    role_id: string;
    status: "active" | "suspended" | "revoked";
    role: {
      name: string;
      display_name: string;
    };
  } | null;
};

/**
 * Resolve the current session and admin authorization in one call.
 *
 * Returns `null` if:
 *   - No Supabase auth session (not logged in)
 *
 * Returns an AdminSession with `admin: null` if:
 *   - Logged in but NOT an admin (no row in admin_users)
 *
 * Returns a full AdminSession if:
 *   - Logged in AND has a row in admin_users with status "active"
 *
 * This function is the single source of truth for "is this request from an
 * active admin?" Both the proxy and server components / API routes use it.
 *
 * NOTE: admin_users is behind RLS that blocks all anon-key reads except the
 * caller's own row. If you tighten RLS to service-role-only, switch this
 * function to use createAdminClient() from lib/supabase/admin.
 */
export async function getAdminUser(): Promise<AdminSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Look up the admin_users row for this auth user. RLS ensures a user
  // can only read their own row (if one exists).
  const { data: adminUser } = await supabase
    .from("admin_users")
    .select(
      `
      id,
      role_id,
      status,
      role:admin_roles (
        name,
        display_name
      )
    `
    )
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    admin: adminUser
      ? {
          id: adminUser.id,
          role_id: adminUser.role_id,
          status: adminUser.status as "active" | "suspended" | "revoked",
          role: {
            name: (adminUser.role as unknown as { name: string }).name,
            display_name: (adminUser.role as unknown as { display_name: string })
              .display_name,
          },
        }
      : null,
  };
}

/**
 * Convenience: is the current user an active admin?
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getAdminUser();
  return Boolean(session?.admin?.status === "active");
}