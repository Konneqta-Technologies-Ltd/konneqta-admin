import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  fetchExpoTokens,
  fetchWebSubscriptions,
  isWebPushConfigured,
  optOutUserIds,
  sendExpoBatch,
  sendPushToUser,
  sendWebPushBatch,
  type ExpoToken,
  type PushPayload,
  type WebSub,
} from "@/lib/admin/notify";

/**
 * Admin broadcasts — one message to an audience, delivered to EVERY surface
 * a user has: in-app row (notifications table = source of truth, read by the
 * web bell and the mobile feed), Web Push (browsers/PWA) and Expo Push
 * (mobile). Per-user opt-out (app Settings) is respected. Everything is
 * audit-logged as broadcast.send.
 */

export const BROADCAST_AUDIENCES = [
  "all",
  "active",
  "pro",
  "free",
  "suspended",
  "deactivated",
] as const;

export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  all: "Everyone",
  active: "Active users",
  pro: "Pro subscribers",
  free: "Free users",
  suspended: "Suspended users",
  deactivated: "Deactivated users",
};

export const BROADCAST_TITLE_MAX = 120;
export const BROADCAST_BODY_MAX = 500;
/** Sanity cap — beyond this the broadcast must be narrowed. */
export const BROADCAST_MAX_RECIPIENTS = 20000;

const RESOLVE_PAGE = 500;
const IN_APP_CHUNK = 500;
const PUSH_CONCURRENCY = 12;

/** Validated ?audience= style facet — anything bogus is null (no filter). */
export function normalizeAudience(a?: string | null): BroadcastAudience | null {
  return a && (BROADCAST_AUDIENCES as readonly string[]).includes(a)
    ? (a as BroadcastAudience)
    : null;
}

/**
 * Deep links are APP-RELATIVE ("/referral", "/settings") — the customer apps
 * prefix them (web: site origin; mobile: konneqta:// scheme). Absolute URLs
 * and protocol-relative "//host" links are rejected: the admin can never
 * point a push notification off-app.
 */
export function sanitizeBroadcastLink(link?: string | null): string | null {
  const clean = (link ?? "").trim();
  if (!clean) return null;
  return clean.startsWith("/") && !clean.startsWith("//") ? clean : null;
}

/**
 * Audience → WHERE clause on the customer directory view.
 *
 * The Supabase query-builder's generics are structurally too deep for TS to
 * chain through a typed helper (TS2589), so this one helper is deliberately
 * untyped — the call sites pass real builders and feed PostgREST.
 */
/* eslint-disable @typescript-eslint/no-explicit-any --
 * query-builder generics cannot survive a helper boundary. */
function applyAudience(
  audience: BroadcastAudience,
  query: any
): any {
  switch (audience) {
    case "pro":
      return query.eq("is_pro_effective", true);
    case "free":
      return query.eq("is_pro_effective", false);
    case "suspended":
      return query.eq("status", "suspended");
    case "deactivated":
      return query.eq("status", "deactivated");
    case "active":
      return query.eq("status", "active");
    case "all":
      return query;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * How many users match an audience — one head-count query (the broadcast
 * form's live "recipients" preview).
 */
export async function countAudience(
  audience: BroadcastAudience
): Promise<number> {
  try {
    const admin = createAdminClient();
    const { count, error } = await applyAudience(
      audience,
      admin.from("admin_customer_directory").select("id", {
        count: "exact",
        head: true,
      })
    );
    if (error) {
      logger.warn("broadcast", "countAudience failed", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    logger.warn("broadcast", "countAudience error (non-fatal)", err);
    return 0;
  }
}

async function resolveAudienceIds(
  audience: BroadcastAudience
): Promise<{ ids: string[]; truncated: boolean }> {
  const admin = createAdminClient();
  const ids: string[] = [];
  let truncated = false;

  for (let from = 0; ; from += RESOLVE_PAGE) {
    if (ids.length >= BROADCAST_MAX_RECIPIENTS) {
      truncated = true;
      break;
    }
    const { data, error } = await applyAudience(
      audience,
      admin
        .from("admin_customer_directory")
        .select("id")
        .order("created_at", { ascending: false, nullsFirst: false })
        .range(from, from + RESOLVE_PAGE - 1)
    );
    if (error) throw new Error(`Audience resolution failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string }>;
    for (const row of rows) {
      if (ids.length >= BROADCAST_MAX_RECIPIENTS) {
        truncated = true;
        break;
      }
      ids.push(row.id);
    }
    if (rows.length < RESOLVE_PAGE) break;
  }

  return { ids, truncated };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type NotificationIdRow = { id: string; user_id: string };

/**
 * Bulk-insert the in-app rows (source of truth for the web bell + mobile
 * feed) and return user_id → notification row id, so each device push can
 * carry the id the app uses to mark it read. Chunked for PostgREST sanity.
 * A failed chunk is logged, never fatal.
 */
async function insertInAppRows(
  userIds: string[],
  content: {
    title: string;
    body: string;
    link: string | null;
    audience: BroadcastAudience;
  }
): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const idsByUser = new Map<string, string>();

  for (const group of chunk(userIds, IN_APP_CHUNK)) {
    const { data, error } = await admin
      .from("notifications")
      .insert(
        group.map((userId) => ({
          user_id: userId,
          type: "admin_broadcast",
          title: content.title,
          body: content.body,
          link: content.link,
          data: { audience: content.audience, source: "admin" },
        }))
      )
      .select("id, user_id");
    if (error) {
      logger.error("broadcast", "in-app insert chunk failed", error);
      continue;
    }
    for (const row of (data ?? []) as NotificationIdRow[]) {
      idsByUser.set(row.user_id, row.id);
    }
  }
  return idsByUser;
}

export type BroadcastResult =
  | {
      ok: true;
      audience: BroadcastAudience;
      /** Audience members who will receive (opt-outs already removed). */
      recipients: number;
      optedOut: number;
      inAppInserted: number;
      pushSent: number;
      pushRemoved: number;
      /** true when the audience hit BROADCAST_MAX_RECIPIENTS. */
      audienceTruncated: boolean;
      /** true when the time budget stopped device pushes early (in-app rows
       * for ALL recipients are ALWAYS inserted first). */
      pushTruncated: boolean;
      webPushConfigured: boolean;
      elapsedMs: number;
    }
  | { ok: false; status: number; error: string };

/**
 * The broadcast pipeline. Order matters:
 *   1. resolve audience ids (Postgres, page by page)
 *   2. drop users who opted out of admin broadcasts
 *   3. insert in-app rows for EVERYONE (never truncated)
 *   4. device pushes with a time budget (serverless-safe), concurrency-limited
 *   5. audit-log the whole thing
 */
export async function runBroadcast(input: {
  title: string;
  body: string;
  link?: string | null;
  audience: BroadcastAudience;
  adminId: string;
  /** Wall-clock budget for the device-push phase (default 50s). */
  timeBudgetMs?: number;
}): Promise<BroadcastResult> {
  const startedAt = Date.now();
  const deadline = startedAt + (input.timeBudgetMs ?? 50_000);
  const link = sanitizeBroadcastLink(input.link);

  try {
    const { ids, truncated: audienceTruncated } = await resolveAudienceIds(
      input.audience
    );
    const optedOutSet = await optOutUserIds();
    const targets = ids.filter((id) => !optedOutSet.has(id));
    const optedOut = ids.length - targets.length;

    const idsByUser = await insertInAppRows(targets, {
      title: input.title,
      body: input.body,
      link,
      audience: input.audience,
    });

    const webSubs: Map<string, WebSub[]> = await fetchWebSubscriptions(targets);
    const expoTokens: Map<string, ExpoToken[]> = await fetchExpoTokens(targets);

    let pushSent = 0;
    let pushRemoved = 0;
    let pushed = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (Date.now() > deadline) return;
        const userId = targets[cursor++];
        const payload: PushPayload = {
          title: input.title,
          body: input.body,
          url: link ?? "/notifications",
          tag: "admin_broadcast",
          notificationId: idsByUser.get(userId) ?? null,
        };
        const [web, expo] = await Promise.all([
          sendWebPushBatch(webSubs.get(userId) ?? [], payload),
          sendExpoBatch(expoTokens.get(userId) ?? [], payload),
        ]);
        pushSent += web.sent + expo.sent;
        pushRemoved += web.removed + expo.removed;
        pushed++;
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(PUSH_CONCURRENCY, Math.max(targets.length, 1)) },
        worker
      )
    );
    const pushTruncated = pushed < targets.length;

    try {
      const { error: auditError } = await createAdminClient()
        .from("admin_audit_logs")
        .insert({
          admin_id: input.adminId,
          action: "broadcast.send",
          target_type: "broadcast",
          target_id: null,
          metadata: {
            audience: input.audience,
            title: input.title,
            link,
            recipients: targets.length,
            opted_out: optedOut,
            in_app_inserted: idsByUser.size,
            push_sent: pushSent,
            push_removed: pushRemoved,
            push_truncated: pushTruncated,
            audience_truncated: audienceTruncated,
            elapsed_ms: Date.now() - startedAt,
          },
        });
      if (auditError) {
        logger.error("broadcast", "audit log insert failed", auditError);
      }
    } catch (auditErr) {
      logger.error("broadcast", "audit log error (non-fatal)", auditErr);
    }

    return {
      ok: true,
      audience: input.audience,
      recipients: targets.length,
      optedOut,
      inAppInserted: idsByUser.size,
      pushSent,
      pushRemoved,
      audienceTruncated,
      pushTruncated,
      webPushConfigured: isWebPushConfigured(),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    logger.error("broadcast", "runBroadcast failed", err);
    return {
      ok: false,
      status: 500,
      error: "Broadcast failed — check server logs.",
    };
  }
}

/**
 * One user (per-user notify panel): in-app row + both device legs in one
 * call. Audit-logged by the API route, not here.
 */
export async function sendToUser(input: {
  userId: string;
  title: string;
  body: string;
  link?: string | null;
}): Promise<
  | { ok: true; pushSent: number; pushRemoved: number }
  | { ok: false; error: string }
> {
  const link = sanitizeBroadcastLink(input.link);
  try {
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("notifications")
      .insert({
        user_id: input.userId,
        type: "admin_broadcast",
        title: input.title,
        body: input.body,
        link,
        data: { audience: "single_user", source: "admin" },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const push = await sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      url: link ?? "/notifications",
      tag: "admin_broadcast",
      notificationId: row?.id ?? null,
    });
    return { ok: true, pushSent: push.sent, pushRemoved: push.removed };
  } catch (err) {
    logger.error("broadcast", "sendToUser failed", err);
    return { ok: false, error: "Could not deliver the notification." };
  }
}