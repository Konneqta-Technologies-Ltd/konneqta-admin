import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  sanitizeBroadcastLink,
  sendToUser,
} from "@/lib/admin/broadcast";

/**
 * POST /api/admin/users/[id]/notify — send a notification to ONE user.
 * Body: { title, body, link? }
 * Lands in their app's notification center AND on every registered device
 * (Web Push + Expo Push). Audited as notification.send.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!(await hasPermission(guard.session, "notifications.send"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    body?: unknown;
    link?: unknown;
  } | null;

  const title =
    typeof body?.title === "string" ? body.title.trim().slice(0, BROADCAST_TITLE_MAX) : "";
  const message =
    typeof body?.body === "string" ? body.body.trim().slice(0, BROADCAST_BODY_MAX) : "";
  const link =
    typeof body?.link === "string" ? sanitizeBroadcastLink(body.link) : null;

  if (!title || !message) {
    return NextResponse.json(
      { error: "A title and a message are required." },
      { status: 400 }
    );
  }

  const result = await sendToUser({ userId: id, title, body: message, link });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  try {
    await createAdminClient().from("admin_audit_logs").insert({
      admin_id: guard.session.admin!.id,
      action: "notification.send",
      target_type: "user",
      target_id: id,
      metadata: {
        title,
        link,
        push_sent: result.pushSent,
        push_removed: result.pushRemoved,
      },
    });
  } catch (auditError) {
    // Logged by supabase client; never fail the send on audit hiccups.
    console.error("[notify] audit insert failed", auditError);
  }

  return NextResponse.json(result);
}