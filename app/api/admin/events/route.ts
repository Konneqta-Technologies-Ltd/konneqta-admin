import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/events — platform event feed for the admin bell.
 * Reads the admin_events view (last 7 days of signups, payments, referral
 * rewards, grants, promo redemptions, broadcasts, suspensions, reports) and
 * computes the per-admin unread count against admin_notification_seen.
 *
 * POST /api/admin/events — "mark all read": upserts the admin's seen marker.
 */
export async function GET() {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!(await hasPermission(guard.session, "users.read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [{ data: rows, error }, { data: seen }] = await Promise.all([
    admin
      .from("admin_events")
      .select("event_type, title, body, link, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("admin_notification_seen")
      .select("seen_at")
      .eq("admin_id", guard.session.admin!.id)
      .maybeSingle(),
  ]);

  if (error) {
    // Expected pre-migration — degrade to an empty feed, never break layout.
    logger.warn("events", "admin_events read failed", error.message);
    return NextResponse.json({ ok: true, events: [], unread: 0, degraded: true });
  }

  const seenAt = seen?.seen_at ? new Date(seen.seen_at).getTime() : 0;
  const events = ((rows ?? []) as Array<{
    event_type: string;
    title: string;
    body: string;
    link: string | null;
    created_at: string;
  }>).map((row) => ({
    type: row.event_type,
    title: row.title,
    body: row.body,
    link: row.link ?? "",
    createdAt: row.created_at,
  }));

  const unread = events.filter(
    (event) => new Date(event.createdAt).getTime() > seenAt
  ).length;

  return NextResponse.json({ ok: true, events, unread });
}

export async function POST() {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!(await hasPermission(guard.session, "users.read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("admin_notification_seen")
    .upsert(
      {
        admin_id: guard.session.admin!.id,
        seen_at: now,
        updated_at: now,
      },
      { onConflict: "admin_id" }
    );

  if (error) {
    logger.error("events", "seen marker upsert failed", error);
    return NextResponse.json(
      { error: "Could not mark events as read." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}