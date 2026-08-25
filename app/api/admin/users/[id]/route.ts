import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, status")
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

  let previousProfileStatus: "active" | "deactivated" =
    profile.status === "deactivated" ? "deactivated" : "active";

  if (body.status === "active") {
    const { data: latestSuspension } = await admin
      .from("admin_audit_logs")
      .select("metadata")
      .eq("action", "user.suspend")
      .eq("target_type", "user")
      .eq("target_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const savedStatus = (latestSuspension?.metadata as {
      previous_profile_status?: string;
    } | null)?.previous_profile_status;
    previousProfileStatus =
      savedStatus === "deactivated" ? "deactivated" : "active";
  }

  const { error: authError } = await admin.rpc("admin_set_user_suspension", {
    target_user_id: id,
    should_suspend: body.status === "suspended",
  });
  if (authError) {
    return NextResponse.json(
      { error: "Unable to update customer authentication access." },
      { status: 500 }
    );
  }

  const nextProfileStatus =
    body.status === "suspended" ? "deactivated" : previousProfileStatus;
  const { error: updateError } = await admin
    .from("profiles")
    .update({ status: nextProfileStatus })
    .eq("id", id);
  if (updateError) {
    await admin.rpc("admin_set_user_suspension", {
      target_user_id: id,
      should_suspend: body.status !== "suspended",
    });
    return NextResponse.json(
      { error: "Unable to update customer profile access." },
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
        body.status === "suspended" ? previousProfileStatus : undefined,
      restored_profile_status:
        body.status === "active" ? previousProfileStatus : undefined,
    },
  });
  if (auditError) {
    console.error("[admin/users] Failed to append audit log:", auditError);
  }

  return NextResponse.json({ success: true });
}