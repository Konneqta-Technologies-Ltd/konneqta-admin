import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminStatus = "active" | "suspended" | "revoked";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (!(await hasPermission(guard.session, "admins.update"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === guard.session.admin!.id) return NextResponse.json({ error: "You cannot change your own role or status." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { roleId?: string; status?: AdminStatus } | null;
  if (!body?.roleId || !body.status || !["active", "suspended", "revoked"].includes(body.status)) return NextResponse.json({ error: "A valid role and status are required." }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: target }, { data: nextRole }] = await Promise.all([
    admin.from("admin_users").select("id, role_id, status, role:admin_roles(name)").eq("id", id).maybeSingle(),
    admin.from("admin_roles").select("id, name").eq("id", body.roleId).maybeSingle(),
  ]);
  if (!target) return NextResponse.json({ error: "Administrator not found." }, { status: 404 });
  if (!nextRole) return NextResponse.json({ error: "Invalid admin role." }, { status: 400 });

  const oldRole = target.role as unknown as { name: string };
  const removesActiveSuperAdmin = oldRole.name === "super_admin" && target.status === "active" && (nextRole.name !== "super_admin" || body.status !== "active");
  if (removesActiveSuperAdmin) {
    const { count } = await admin.from("admin_users").select("id, role:admin_roles!inner(name)", { count: "exact", head: true }).eq("status", "active").eq("admin_roles.name", "super_admin");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "At least one active Super Admin is required." }, { status: 400 });
  }

  const { error } = await admin.from("admin_users").update({ role_id: body.roleId, status: body.status }).eq("id", id);
  if (error) return NextResponse.json({ error: "Unable to update administrator." }, { status: 500 });
  await admin.from("admin_audit_logs").insert({ admin_id: guard.session.admin!.id, action: "admin.update", target_type: "admin", target_id: id, metadata: { from_role: oldRole.name, to_role: nextRole.name, from_status: target.status, to_status: body.status } });
  return NextResponse.json({ success: true });
}