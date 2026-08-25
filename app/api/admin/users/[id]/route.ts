import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status }
    );
  }
  if (!(await hasPermission(guard.session, "users.update"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    status?: string;
  } | null;
  if (body?.status !== "active" && body?.status !== "suspended") {
    return NextResponse.json(
      { error: "Invalid account status." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json(
      { error: "Unable to read customer profile." },
      { status: 500 }
    );
  }
  if (!profile) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // ATOMIC suspension: the admin_set_customer_suspension RPC
  // (supabase/admin-data-views.sql) applies the auth ban AND the profile
  // status in ONE transaction, saving the pre-suspension status on the row
  // so unsuspend restores it exactly. Replaces the old two-write flow whose
  // restore depended on best-effort audit-log metadata.
  const { data: previousProfileStatus, error: rpcError } = await admin.rpc(
    "admin_set_customer_suspension",
    { target_user_id: id, should_suspend: body.status === "suspended" }
  );
  if (rpcError) {
    logger.error("admin/users", "Suspension RPC failed", rpcError);
    return NextResponse.json(
      { error: "Unable to update customer account." },
      { status: 500 }
    );
  }

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_id: guard.session.admin!.id,
    action: body.status === "suspended" ? "user.suspend" : "user.unsuspend",
    target_type: "user",
    target_id: id,
    metadata: {
      status: body.status,
      previous_profile_status:
        body.status === "suspended"
          ? (previousProfileStatus as string | null)
          : undefined,
      restored_profile_status:
        body.status === "active"
          ? (previousProfileStatus as string | null)
          : undefined,
    },
  });
  if (auditError) {
    logger.error("admin/users", "Failed to append audit log", auditError);
  }

  return NextResponse.json({ success: true });
}