import { cache } from "react";
import { redirect } from "next/navigation";
import { getAdminUser, type AdminSession } from "@/lib/auth/session";

/**
 * Server-side guard for Pages / Layouts (Server Components).
 *
 * Redirects to /login when:
 *   - Not authenticated
 *   - Not an admin (no admin_users row)
 *   - Admin status is not "active"
 *
 * Returns the active AdminSession for downstream use.
 *
 * Usage:
 *   const session = await requireAdmin();
 *   // session.admin.role.display_name, session.email, ...
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminUser();

  if (!session) {
    redirect("/login");
  }

  if (!session.admin || session.admin.status !== "active") {
    // Authenticated but not an active admin. Sign them out server-side is
    // not possible here; the login page will detect this state and show
    // "Access denied". Redirect with a flag the login page can read.
    redirect("/login?error=not_authorized");
  }

  return session;
}

/**
 * Server-side guard for API routes / Server Actions.
 *
 * Unlike requireAdmin() (which redirects), this RETURNS a result so the
 * caller can respond with a proper HTTP status code.
 *
 * Usage:
 *   const guard = await requireAdminApi();
 *   if (!guard.ok) {
 *     return Response.json({ error: guard.error }, { status: guard.status });
 *   }
 *   const session = guard.session;
 */
export async function requireAdminApi(): Promise<
  | { ok: true; session: AdminSession }
  | { ok: false; error: string; status: number }
> {
  const session = await getAdminUser();

  if (!session) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  if (!session.admin) {
    return { ok: false, error: "Forbidden — not an admin", status: 403 };
  }

  if (session.admin.status !== "active") {
    return {
      ok: false,
      error: "Forbidden — admin account is not active",
      status: 403,
    };
  }

  return { ok: true, session };
}

export const hasPermission = cache(
  /**
   * Permission check for API routes (Phase 2+).
   *
   * Checks whether the active admin's role has a given permission
   * (e.g. "users.read", "admins.create") via admin_role_permissions.
   *
   * Super Admin always passes: the role is defined as "Full, unrestricted
   * access to every admin capability", so it must never be at the mercy of a
   * missing/stale permission seed row.
   *
   * Always pair with requireAdminApi() — this function assumes the caller
   * is already verified as an active admin.
   *
   * Wrapped in React `cache()`: pages check several permissions per render
   * and each check is a Supabase round trip — this dedupes them per request.
   */
  async function hasPermission(
    session: AdminSession,
    permission: string
  ): Promise<boolean> {
    // Super Admin bypasses every permission check.
    if (session.admin?.role.name === "super_admin") return true;

    // Import lazily to avoid cycles; createAdminClient is server-only.
    const { createAdminClient } = await import("@/lib/supabase/admin");

    const admin = createAdminClient();

    const { data } = await admin
      .from("admin_role_permissions")
      .select("permission:admin_permissions (name)")
      .eq("role_id", session.admin!.role_id);

    if (!data) return false;

    return data.some(
      (row) =>
        (row.permission as unknown as { name: string } | null)?.name ===
        permission
    );
  }
);