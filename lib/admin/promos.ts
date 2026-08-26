import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Promo codes — admin-side management (create / list / enable / disable).
 *
 * A code grants free Premium DAYS when redeemed in the customer app
 * (Settings → "Promo code"). The redemption itself — including every rule
 * (active, window, once-per-account, max_uses, day stacking) — happens in the
 * customer DB's `redeem_promo` RPC (konneqta/supabase/promo-codes-setup.sql).
 * This module only manages the code rows and appends to admin_audit_logs,
 * mirroring lib/admin/grants.ts conventions.
 */

export const PROMO_MAX_DAYS = 3650;

/** Matches the promo_codes.code CHECK constraint. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_]{3,30}$/;

export type PromoRow = {
  id: string;
  code: string;
  description: string | null;
  reward_days: number;
  max_uses: number | null;
  uses: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
};

export type PromoState =
  | "Active"
  | "Scheduled"
  | "Expired"
  | "Fully redeemed"
  | "Disabled";

/**
 * Lifecycle label for a code row. Pure + testable (optional `now` param so
 * tests don't depend on the clock). Kept OUTSIDE components per the admin
 * repo's render-purity convention.
 */
export function promoState(
  promo: {
    active: boolean;
    valid_from: string;
    valid_until: string | null;
    max_uses: number | null;
    uses: number;
  },
  now: Date = new Date()
): PromoState {
  if (!promo.active) return "Disabled";
  if (new Date(promo.valid_from).getTime() > now.getTime()) return "Scheduled";
  if (
    promo.valid_until !== null &&
    new Date(promo.valid_until).getTime() < now.getTime()
  ) {
    return "Expired";
  }
  if (promo.max_uses !== null && promo.uses >= promo.max_uses) {
    return "Fully redeemed";
  }
  return "Active";
}

export type PromoOutcome =
  | { ok: true; promo: PromoRow }
  | { ok: false; status: number; error: string };

/**
 * Create a promo code. `validUntil` NULL = never expires. `maxUses` NULL =
 * unlimited redemptions. Audit-logged as promo.create.
 */
export async function createPromo(input: {
  code: string;
  rewardDays: number;
  maxUses?: number | null;
  validUntil?: string | null;
  description?: string | null;
  adminId: string;
}): Promise<PromoOutcome> {
  const code = input.code.trim().toUpperCase();
  if (!PROMO_CODE_PATTERN.test(code)) {
    return {
      ok: false,
      status: 400,
      error:
        "Code must be 3–30 characters: letters, numbers or underscores (e.g. WELCOME30).",
    };
  }

  const days = Math.trunc(input.rewardDays);
  if (!Number.isFinite(days) || days < 1 || days > PROMO_MAX_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `Days must be a whole number between 1 and ${PROMO_MAX_DAYS}.`,
    };
  }

  const maxUses =
    input.maxUses === null || input.maxUses === undefined
      ? null
      : Math.trunc(input.maxUses);
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
    return {
      ok: false,
      status: 400,
      error: "Max uses must be a positive whole number (or empty for unlimited).",
    };
  }

  let validUntil: string | null = null;
  if (input.validUntil) {
    const parsed = new Date(input.validUntil);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, error: "Invalid expiry date." };
    }
    if (parsed.getTime() <= Date.now()) {
      return {
        ok: false,
        status: 400,
        error: "The expiry date must be in the future.",
      };
    }
    validUntil = parsed.toISOString();
  }

  const admin = createAdminClient();

  const { data: inserted, error } = await admin
    .from("promo_codes")
    .insert({
      code,
      reward_days: days,
      max_uses: maxUses,
      valid_until: validUntil,
      description: input.description?.trim() || null,
      created_by: input.adminId,
    })
    .select(
      "id, code, description, reward_days, max_uses, uses, valid_from, valid_until, active, created_at"
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        status: 409,
        error: `The code "${code}" already exists.`,
      };
    }
    logger.error("promos", "create failed", error);
    return { ok: false, status: 500, error: "Unable to create the promo code." };
  }

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_id: input.adminId,
    action: "promo.create",
    target_type: "promo",
    target_id: inserted.id,
    metadata: { code, reward_days: days, max_uses: maxUses, valid_until: validUntil },
  });
  if (auditError) {
    logger.error("promos", "audit log insert failed", auditError);
  }

  return { ok: true, promo: inserted as PromoRow };
}

/**
 * Enable or disable a code — the manual kill switch. Disabling stops NEW
 * redemptions instantly; days already redeemed are preserved (they live on
 * each user's pro_expires_at). Audit-logged as promo.enable / promo.disable.
 */
export async function togglePromo(input: {
  id: string;
  active: boolean;
  adminId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient();

  const { data: promo, error: findError } = await admin
    .from("promo_codes")
    .select("id, code, active")
    .eq("id", input.id)
    .maybeSingle();

  if (findError) {
    logger.error("promos", "toggle lookup failed", findError);
    return { ok: false, status: 500, error: "Unable to read the promo code." };
  }
  if (!promo) {
    return { ok: false, status: 404, error: "Promo code not found." };
  }
  if (promo.active === input.active) {
    return {
      ok: false,
      status: 400,
      error: `The code is already ${input.active ? "enabled" : "disabled"}.`,
    };
  }

  const { error: updateError } = await admin
    .from("promo_codes")
    .update({ active: input.active })
    .eq("id", input.id);

  if (updateError) {
    logger.error("promos", "toggle failed", updateError);
    return {
      ok: false,
      status: 500,
      error: "Unable to update the promo code. Try again.",
    };
  }

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_id: input.adminId,
    action: input.active ? "promo.enable" : "promo.disable",
    target_type: "promo",
    target_id: input.id,
    metadata: { code: promo.code },
  });
  if (auditError) {
    logger.error("promos", "audit log insert failed", auditError);
  }

  return { ok: true };
}

/**
 * All codes, newest first. Returns [] when the table doesn't exist yet (the
 * migration hasn't been run) so the page degrades to an empty list instead
 * of crashing — same convention as listGrants().
 */
export async function listPromos(options?: {
  limit?: number;
}): Promise<PromoRow[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("promo_codes")
      .select(
        "id, code, description, reward_days, max_uses, uses, valid_from, valid_until, active, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(options?.limit ?? 100);

    if (error) {
      logger.warn("promos", "listPromos failed", error.message);
      return [];
    }
    return (data ?? []) as PromoRow[];
  } catch (err) {
    logger.warn("promos", "listPromos error (non-fatal)", err);
    return [];
  }
}
