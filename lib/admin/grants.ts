import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Complimentary Pro grants — grant/revoke Pro without payment.
 *
 * A grant simply writes `profiles.plan = 'pro'` and `profiles.pro_expires_at`
 * with the service-role client (the customer app's `protect_entitlements`
 * DB trigger permits exactly that role), so the customer app's lazy `isPro()`
 * expiry drops the user back to free the instant the timestamp passes — no
 * cron, no customer-app changes. Every mutation also appends to
 * `admin_audit_logs` (the shared audit viewer) and a `pro_grants` row
 * (source of truth for the grants list UI).
 */

export const GRANT_MAX_DAYS = 3650;

export type GrantOutcome =
  | {
      ok: true;
      username: string;
      days: number;
      expiresAt: string;
      /** True when the grant stacked onto a still-active Pro window. */
      extended: boolean;
    }
  | { ok: false; status: number; error: string };

export type ProGrantRow = {
  id: string;
  user_id: string;
  username: string;
  days: number;
  expires_at: string;
  note: string | null;
  revoked_at: string | null;
  created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lifecycle label for a grant row. Kept OUTSIDE the components so pages stay
 * render-pure (the react-hooks/purity lint rule forbids Date.now() during
 * render): "Active" | "Revoked" | "Expired".
 */
export function grantState(grant: {
  expires_at: string;
  revoked_at: string | null;
}): "Active" | "Revoked" | "Expired" {
  if (grant.revoked_at) return "Revoked";
  if (new Date(grant.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

/**
 * Effective Pro state for a profile, mirroring the customer app's lazy
 * isPro() expiry. Returns isPro + whole days left (null = no expiry known).
 */
export function proState(profile: {
  plan?: string | null;
  is_exempt?: boolean | null;
  pro_expires_at?: string | null;
}): { isPro: boolean; daysLeft: number | null } {
  if (profile.is_exempt) return { isPro: true, daysLeft: null };
  if (profile.plan !== "pro" || !profile.pro_expires_at) {
    return { isPro: false, daysLeft: null };
  }
  const remaining = new Date(profile.pro_expires_at).getTime() - Date.now();
  if (remaining <= 0) return { isPro: false, daysLeft: 0 };
  return { isPro: true, daysLeft: Math.ceil(remaining / DAY_MS) };
}

/**
 * Grant `days` of complimentary Pro to a customer.
 *
 * Extension semantics: when the user is currently Pro with an unexpired
 * window, the new expiry starts from the EXISTING expiry (stacking) instead
 * of from now. Exempt users are refused — they are already unlimited.
 */
export async function grantPro(input: {
  userId: string;
  days: number;
  note?: string | null;
  /** admin_users.id of the acting admin (audit). */
  adminId: string;
}): Promise<GrantOutcome> {
  const days = Math.trunc(input.days);
  if (!Number.isFinite(days) || days < 1 || days > GRANT_MAX_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `Days must be a whole number between 1 and ${GRANT_MAX_DAYS}.`,
    };
  }

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, username, plan, is_exempt, pro_expires_at")
    .eq("id", input.userId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "Unable to read the customer profile." };
  }
  if (!profile) {
    return { ok: false, status: 404, error: "User not found." };
  }
  if (profile.is_exempt) {
    return {
      ok: false,
      status: 400,
      error: "This user is exempt and already has unlimited access.",
    };
  }

  const now = Date.now();
  const currentExpiry = profile.pro_expires_at
    ? new Date(profile.pro_expires_at).getTime()
    : 0;
  const extended = profile.plan === "pro" && currentExpiry > now;
  const base = extended ? currentExpiry : now;
  const expiresAt = new Date(base + days * DAY_MS).toISOString();

  const { error: updateError } = await admin
    .from("profiles")
    .update({ plan: "pro", pro_expires_at: expiresAt })
    .eq("id", profile.id);

  if (updateError) {
    logger.error("grants", "profile update failed", updateError);
    return { ok: false, status: 500, error: "Unable to update the plan. Try again." };
  }

  const note = input.note?.trim().slice(0, 200) || null;
  const { error: grantError } = await admin
    .from("pro_grants")
    .insert({
      user_id: profile.id,
      granted_by: input.adminId,
      username: profile.username ?? "",
      days,
      expires_at: expiresAt,
      note,
    });
  if (grantError) {
    logger.error("grants", "pro_grants insert failed", grantError);
  }

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_id: input.adminId,
    action: "user.grant_pro",
    target_type: "user",
    target_id: profile.id,
    metadata: { days, note, expires_at: expiresAt, extended },
  });
  if (auditError) {
    logger.error("grants", "audit log insert failed", auditError);
  }

  return {
    ok: true,
    username: profile.username ?? "",
    days,
    expiresAt,
    extended,
  };
}

/**
 * Revoke complimentary Pro from a customer immediately.
 *
 * SAFETY GUARD: refuses while the user has an active PAID subscription
 * (subscriptions.status = 'active' AND origin = 'subscription') so a paying
 * customer is never downgraded from this tool — that must go through the
 * billing flow. Backfilled 'legacy' rows don't block a revoke.
 */
export async function revokePro(input: {
  userId: string;
  adminId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, is_exempt")
    .eq("id", input.userId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "Unable to read the customer profile." };
  }
  if (!profile) {
    return { ok: false, status: 404, error: "User not found." };
  }
  if (profile.is_exempt) {
    return {
      ok: false,
      status: 400,
      error: "Exempt users cannot be revoked — their access is permanent.",
    };
  }

  const { data: activePaidSub } = await admin
    .from("subscriptions")
    .select("id")
    .eq("user_id", profile.id)
    .eq("status", "active")
    .eq("origin", "subscription")
    .maybeSingle();

  if (activePaidSub) {
    return {
      ok: false,
      status: 409,
      error:
        "This user has an active paid subscription — cancel it via the billing flow first.",
    };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ plan: "free", pro_expires_at: null })
    .eq("id", profile.id);

  if (updateError) {
    logger.error("grants", "downgrade failed", updateError);
    return { ok: false, status: 500, error: "Unable to downgrade. Try again." };
  }

  const now = new Date().toISOString();
  const { error: grantsError } = await admin
    .from("pro_grants")
    .update({ revoked_at: now, revoked_by: input.adminId })
    .eq("user_id", profile.id)
    .is("revoked_at", null);
  if (grantsError) {
    logger.error("grants", "marking grants revoked failed", grantsError);
  }

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_id: input.adminId,
    action: "user.revoke_pro",
    target_type: "user",
    target_id: profile.id,
    metadata: {},
  });
  if (auditError) {
    logger.error("grants", "audit log insert failed", auditError);
  }

  return { ok: true };
}

/**
 * Recent grants, newest first. Scope to one user with `userId`, or omit it
 * for the global /admin/grants page. Returns [] when the table isn't created
 * yet so both pages degrade to an empty list instead of crashing.
 */
/** Allow-listed ?status= values for the grants page. */
export const GRANT_STATUS_FILTERS = ["active", "expired", "revoked"] as const;
export type GrantStatusFilter = (typeof GRANT_STATUS_FILTERS)[number];

export async function listGrants(options?: {
  userId?: string;
  limit?: number;
  status?: GrantStatusFilter;
}): Promise<ProGrantRow[]> {
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    let query = admin
      .from("pro_grants")
      .select(
        "id, user_id, username, days, expires_at, note, revoked_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(options?.limit ?? 100);

    if (options?.userId) {
      query = query.eq("user_id", options.userId);
    }

    // Mirrors grantState() precedence: Revoked > Expired > Active.
    switch (options?.status) {
      case "revoked":
        query = query.not("revoked_at", "is", null);
        break;
      case "active":
        query = query.is("revoked_at", null).gt("expires_at", now);
        break;
      case "expired":
        query = query.is("revoked_at", null).lte("expires_at", now);
        break;
    }

    const { data, error } = await query;
    if (error) {
      logger.warn("grants", "listGrants failed", error.message);
      return [];
    }
    return (data ?? []) as ProGrantRow[];
  } catch (err) {
    logger.warn("grants", "listGrants error (non-fatal)", err);
    return [];
  }
}

