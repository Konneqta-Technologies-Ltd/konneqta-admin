import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  countAudience,
  normalizeAudience,
  runBroadcast,
  sanitizeBroadcastLink,
} from "@/lib/admin/broadcast";

/**
 * POST /api/admin/broadcast
 * Body: { audience, title, body, link?, dryRun? }
 *
 * dryRun: true → returns ONLY the recipient count (the composer's live
 * preview). Otherwise runs the full pipeline (in-app rows + Web Push +
 * Expo Push, opt-outs respected) and is audit-logged as broadcast.send.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!(await hasPermission(guard.session, "notifications.send"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    audience?: unknown;
    title?: unknown;
    body?: unknown;
    link?: unknown;
    dryRun?: unknown;
  } | null;

  const audience = normalizeAudience(
    typeof body?.audience === "string" ? body.audience : null
  );
  if (!audience) {
    return NextResponse.json(
      { error: "A valid audience is required." },
      { status: 400 }
    );
  }

  // Preview only — no message content needed.
  if (body?.dryRun === true) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      audience,
      count: await countAudience(audience),
    });
  }

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

  const result = await runBroadcast({
    title,
    body: message,
    link,
    audience,
    adminId: guard.session.admin!.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}