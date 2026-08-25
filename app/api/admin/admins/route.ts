import { NextResponse, type NextRequest } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Look up an auth user by email via the admin_find_auth_user_id_by_email RPC
 * (supabase/admin-data-views.sql) — one indexed query instead of paging
 * through auth.admin.listUsers().
 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_find_auth_user_id_by_email", {
    p_email: email,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function POST(request: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (!(await hasPermission(guard.session, "admins.create"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { email?: string; roleId?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const roleId = body?.roleId?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !roleId) return NextResponse.json({ error: "A valid email and role are required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: role } = await admin.from("admin_roles").select("id, name").eq("id", roleId).maybeSingle();
  if (!role) return NextResponse.json({ error: "Invalid admin role." }, { status: 400 });

  try {
    let authUserId = await findAuthUserIdByEmail(email);
    let invited = false;

    if (!authUserId) {
      const redirectTo = new URL("/auth/callback?next=/admin/setup-password", request.url).toString();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error || !data.user) throw error ?? new Error("Supabase did not create the invited user.");
      authUserId = data.user.id;
      invited = true;
    }

    const { data: existing } = await admin.from("admin_users").select("id").eq("user_id", authUserId).maybeSingle();
    if (existing) return NextResponse.json({ error: "This user is already an administrator." }, { status: 409 });

    const { data: created, error: insertError } = await admin.from("admin_users").insert({ user_id: authUserId, role_id: roleId, status: "active", invited_by: guard.session.admin!.id, invited_at: new Date().toISOString() }).select("id").single();
    if (insertError) {
      if (invited) await admin.auth.admin.deleteUser(authUserId);
      throw insertError;
    }

    await admin.from("admin_audit_logs").insert({ admin_id: guard.session.admin!.id, action: "admin.create", target_type: "admin", target_id: created.id, metadata: { email, role: role.name, invitation_sent: invited } });
    return NextResponse.json({ success: true, message: invited ? `Invitation sent to ${email}.` : `${email} was granted admin access.` });
  } catch (error) {
    logger.error("admin/admins", "Invite failed", error);
    return NextResponse.json({ error: "Unable to create the administrator account." }, { status: 500 });
  }
}