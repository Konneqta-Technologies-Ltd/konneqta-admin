import { NextResponse, type NextRequest } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";

async function findAuthUserByEmail(email: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) break;
  }
  return null;
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
    let authUser = await findAuthUserByEmail(email);
    let invited = false;

    if (!authUser) {
      const redirectTo = new URL("/auth/callback?next=/admin/setup-password", request.url).toString();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error || !data.user) throw error ?? new Error("Supabase did not create the invited user.");
      authUser = data.user;
      invited = true;
    }

    const { data: existing } = await admin.from("admin_users").select("id").eq("user_id", authUser.id).maybeSingle();
    if (existing) return NextResponse.json({ error: "This user is already an administrator." }, { status: 409 });

    const { data: created, error: insertError } = await admin.from("admin_users").insert({ user_id: authUser.id, role_id: roleId, status: "active", invited_by: guard.session.admin!.id, invited_at: new Date().toISOString() }).select("id").single();
    if (insertError) {
      if (invited) await admin.auth.admin.deleteUser(authUser.id);
      throw insertError;
    }

    await admin.from("admin_audit_logs").insert({ admin_id: guard.session.admin!.id, action: "admin.create", target_type: "admin", target_id: created.id, metadata: { email, role: role.name, invitation_sent: invited } });
    return NextResponse.json({ success: true, message: invited ? `Invitation sent to ${email}.` : `${email} was granted admin access.` });
  } catch (error) {
    console.error("[admin/admins] Invite failed:", error);
    return NextResponse.json({ error: "Unable to create the administrator account." }, { status: 500 });
  }
}