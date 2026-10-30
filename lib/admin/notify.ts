import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Device push senders (server-only) — the admin app's port of the customer
 * app's lib/push/server.ts. Fans a notification out to EVERY device surface
 * a user has registered:
 *   1. Web Push (VAPID) → browser/PWA subscriptions (push_subscriptions)
 *   2. Expo Push        → the native app's devices (mobile_push_tokens)
 *
 * Both legs are fire-and-forget by contract: never throw to the caller, and
 * self-clean registrations the push services report as gone. The in-app row
 * in `notifications` remains the source of truth (the web bell and the
 * mobile app's feed read it), so a failed device send is never fatal.
 *
 * Env vars (SAME VALUES as the customer web app):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — shared with browsers for subscribe()
 *   VAPID_PRIVATE_KEY            — server-only signing key
 *   VAPID_SUBJECT                — contact URI (mailto:) for the push service
 * The Expo leg needs NO server keys — the token encodes the project.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** App-relative deep link opened on tap (e.g. "/referral"). */
  url?: string | null;
  /** Collapse key — stacks replaces within the same type. */
  tag?: string;
  /** In-app notification row id (lets the app mark it read on open). */
  notificationId?: string | null;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK = 100;

let configured = false;

function ensureConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:info@konneqta.com",
      pub,
      priv,
    );
    configured = true;
  }
  return true;
}

/**
 * True when Web Push can actually send. Broadcasts still work without it —
 * in-app rows insert regardless — but device delivery is browser-only-off.
 */
export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

/** Delete a dead Web Push subscription by row id (never throws). */
async function deleteWebSubscription(id: string): Promise<void> {
  try {
    await createAdminClient().from("push_subscriptions").delete().eq("id", id);
  } catch (err) {
    logger.warn("notify", "push_subscriptions delete failed", err);
  }
}

/** Delete a dead Expo push token by row id (never throws). */
async function deleteExpoToken(id: string): Promise<void> {
  try {
    await createAdminClient().from("mobile_push_tokens").delete().eq("id", id);
  } catch (err) {
    logger.warn("notify", "mobile_push_tokens delete failed", err);
  }
}

/**
 * Leg 1 — VAPID Web Push to ONE user's browser/PWA subscriptions.
 * Returns { sent, removed } (removed = dead subscriptions cleaned up).
 */
export async function sendWebPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  if (!ensureConfigured()) {
    // Keys not configured (e.g. preview env) — browser push silently off.
    return { sent: 0, removed: 0 };
  }

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs?.length) return { sent: 0, removed: 0 };

  const json = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.allSettled(
    subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json
        );
        sent++;
      } catch (err) {
        const statusCode =
          (err as { statusCode?: number })?.statusCode ?? undefined;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription no longer exists at the push service — remove it
          // so it doesn't poison every future send.
          await deleteWebSubscription(sub.id);
          removed++;
        }
        // 429 (rate limited) + transient network errors: skip silently —
        // the in-app notification row is the source of truth.
      }
    })
  );

  return { sent, removed };
}

/**
 * Leg 2 — Expo Push to ONE user's mobile devices. The web `url` (e.g.
 * "/referral") travels in `data`; the app deep-links on tap via its
 * konneqta:// scheme. `channelId: 'konneqta'` matches the HIGH-importance
 * channel the app creates at registration (konneqta-mobile/src/lib/push.ts).
 */
export async function sendExpoPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  const admin = createAdminClient();
  const { data: tokens } = await admin
    .from("mobile_push_tokens")
    .select("id, token")
    .eq("user_id", userId);

  if (!tokens?.length) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  for (let i = 0; i < tokens.length; i += EXPO_PUSH_CHUNK) {
    const chunkRows = tokens.slice(i, i + EXPO_PUSH_CHUNK) as Array<{
      id: string;
      token: string;
    }>;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          chunkRows.map((row) => ({
            to: row.token,
            title: payload.title,
            body: payload.body,
            sound: "default",
            channelId: "konneqta",
            data: {
              url: payload.url ?? null,
              notificationId: payload.notificationId ?? null,
              tag: payload.tag ?? null,
            },
          }))
        ),
      });

      const result = (await res.json().catch(() => ({}))) as {
        data?: {
          status: "ok" | "error";
          message?: string;
          details?: { error?: string };
        }[];
      };

      (result.data ?? []).forEach((ticket, index) => {
        if (ticket.status === "ok") {
          sent++;
          return;
        }
        // DeviceNotRegistered = app uninstalled / token rotated — remove the
        // row so it doesn't poison every future send (web-push parity).
        if (ticket.details?.error === "DeviceNotRegistered" && chunkRows[index]) {
          void deleteExpoToken(chunkRows[index].id);
          removed++;
        }
        // Everything else (rate limits, transient errors): skip silently.
      });
    } catch {
      // Network-level failure — skip silently; the in-app row is the truth.
    }
  }

  return { sent, removed };
}

/**
 * Fan a notification out to every device surface of ONE user. Both legs run
 * in parallel; each swallows its own errors (non-fatal by contract).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  const [web, expo] = await Promise.allSettled([
    sendWebPushToUser(userId, payload),
    sendExpoPushToUser(userId, payload),
  ]);

  const sent =
    (web.status === "fulfilled" ? web.value.sent : 0) +
    (expo.status === "fulfilled" ? expo.value.sent : 0);
  const removed =
    (web.status === "fulfilled" ? web.value.removed : 0) +
    (expo.status === "fulfilled" ? expo.value.removed : 0);

  return { sent, removed };
}

/**
 * Bulk helpers for broadcasts. Resolving one user at a time (N queries for N
 * recipients) would blow past serverless limits, so audiences resolve their
 * subscriptions in bulk here and hand grouped rows to the batch senders.
 */

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export type WebSub = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type ExpoToken = { id: string; userId: string; token: string };

/**
 * All Web Push subscriptions for a set of users, keyed by user_id.
 * PostgREST URL length is bounded — ids stream in chunks of 100.
 */
export async function fetchWebSubscriptions(
  userIds: string[]
): Promise<Map<string, WebSub[]>> {
  const map = new Map<string, WebSub[]>();
  if (!userIds.length) return map;

  const admin = createAdminClient();
  for (const ids of chunk(userIds, 100)) {
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (error) {
      logger.warn("notify", "fetchWebSubscriptions chunk failed", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{
      id: string;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>) {
      const list = map.get(row.user_id) ?? [];
      list.push({
        id: row.id,
        userId: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
      });
      map.set(row.user_id, list);
    }
  }
  return map;
}

/** All Expo push tokens for a set of users, keyed by user_id. */
export async function fetchExpoTokens(
  userIds: string[]
): Promise<Map<string, ExpoToken[]>> {
  const map = new Map<string, ExpoToken[]>();
  if (!userIds.length) return map;

  const admin = createAdminClient();
  for (const ids of chunk(userIds, 100)) {
    const { data, error } = await admin
      .from("mobile_push_tokens")
      .select("id, user_id, token")
      .in("user_id", ids);
    if (error) {
      logger.warn("notify", "fetchExpoTokens chunk failed", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{
      id: string;
      user_id: string;
      token: string;
    }>) {
      const list = map.get(row.user_id) ?? [];
      list.push({ id: row.id, userId: row.user_id, token: row.token });
      map.set(row.user_id, list);
    }
  }
  return map;
}

/**
 * Web Push to MANY subscriptions in one call (per-item error handling
 * identical to the single-user leg). Returns { sent, removed }.
 */
export async function sendWebPushBatch(
  subs: WebSub[],
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  if (!ensureConfigured() || !subs.length) return { sent: 0, removed: 0 };
  const json = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json
        );
        sent++;
      } catch (err) {
        const statusCode =
          (err as { statusCode?: number })?.statusCode ?? undefined;
        if (statusCode === 404 || statusCode === 410) {
          await deleteWebSubscription(sub.id);
          removed++;
        }
      }
    })
  );

  return { sent, removed };
}

/**
 * Expo Push to MANY tokens in one call — chunks of EXPO_PUSH_CHUNK per API
 * request, DeviceNotRegistered rows removed (same contract as single-user).
 */
export async function sendExpoBatch(
  tokens: ExpoToken[],
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  let removed = 0;
  if (!tokens.length) return { sent, removed };

  for (const batch of chunk(tokens, EXPO_PUSH_CHUNK)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          batch.map((row) => ({
            to: row.token,
            title: payload.title,
            body: payload.body,
            sound: "default",
            channelId: "konneqta",
            data: {
              url: payload.url ?? null,
              notificationId: payload.notificationId ?? null,
              tag: payload.tag ?? null,
            },
          }))
        ),
      });

      const result = (await res.json().catch(() => ({}))) as {
        data?: {
          status: "ok" | "error";
          details?: { error?: string };
        }[];
      };

      (result.data ?? []).forEach((ticket, index) => {
        if (ticket.status === "ok") {
          sent++;
        } else if (
          ticket.details?.error === "DeviceNotRegistered" &&
          batch[index]
        ) {
          void deleteExpoToken(batch[index].id);
          removed++;
        }
      });
    } catch {
      // Network-level failure — skip silently; the in-app row is the truth.
    }
  }

  return { sent, removed };
}

/**
 * Users who opted OUT of admin broadcasts in their app Settings
 * (notification_preferences.admin_broadcast = false). Missing rows = all-on,
 * matching the customer app's preference contract. Never throws.
 */
export async function optOutUserIds(): Promise<Set<string>> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("notification_preferences")
      .select("user_id")
      .eq("admin_broadcast", false);
    if (error) {
      logger.warn("notify", "optOutUserIds failed", error.message);
      return new Set();
    }
    return new Set(
      ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
    );
  } catch (err) {
    logger.warn("notify", "optOutUserIds error (non-fatal)", err);
    return new Set();
  }
}