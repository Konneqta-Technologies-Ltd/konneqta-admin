import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Referrals — admin-side reads (who signed up with which code, who converted).
 * The referral system itself (code generation, attach rules, rewards) lives
 * in the CUSTOMER app (konneqta/lib/referrals/* + the shared `referrals`
 * table). This module only reads, mirroring lib/admin/promos.ts conventions.
 */

/** Referral codes are uppercase A-Z0-9, 6–25 chars (customer app rules). */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6,25}$/;

export type ReferralStatus = "signed_up" | "rewarded" | "revoked";

export const REFERRAL_STATUSES: readonly ReferralStatus[] = [
  "signed_up",
  "rewarded",
  "revoked",
];

export type ReferralRow = {
  id: string;
  code: string;
  status: ReferralStatus;
  rewardDays: number;
  /** When the referred user attached the code (≈ their signup moment). */
  createdAt: string;
  /** When their first payment converted (referrer rewarded). */
  rewardedAt: string | null;
  revokedAt: string | null;
  referred: {
    id: string;
    email: string | null;
    username: string | null;
    fullName: string | null;
  };
  referrer: {
    id: string;
    email: string | null;
    username: string | null;
    fullName: string | null;
    /** Referrer's CURRENT shareable code (code_snapshot may be stale). */
    code: string | null;
  };
};

export type ReferralLeaderboardRow = {
  referrerId: string;
  username: string | null;
  fullName: string | null;
  code: string | null;
  email: string | null;
  signups: number;
  rewards: number;
  daysAwarded: number;
  lastRewardedAt: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export type DateRange = { from: string | null; to: string | null };

/**
 * Validated ?from/&to date facet. Garbage params become null (= no filter)
 * so a bogus URL can never widen or break the query; a reversed range is
 * silently swapped. Both values are inclusive YYYY-MM-DD calendar dates —
 * convert with isoStartOfDay/isoNextDay at the query boundary.
 */
export function normalizeDateRange(
  from?: string | null,
  to?: string | null
): DateRange {
  let cleanFrom = from && isValidDateString(from.trim()) ? from.trim() : null;
  let cleanTo = to && isValidDateString(to.trim()) ? to.trim() : null;
  if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
    [cleanFrom, cleanTo] = [cleanTo, cleanFrom];
  }
  return { from: cleanFrom, to: cleanTo };
}

/** Inclusive lower bound (day start, UTC) for a YYYY-MM-DD date. */
export function isoStartOfDay(dateStr: string): string {
  return `${dateStr}T00:00:00Z`;
}

/** EXCLUSIVE upper bound for an inclusive YYYY-MM-DD end date (UTC midnight
 * after) — so `to=2026-10-31` includes every moment of the 31st. */
export function isoNextDay(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

/** Validated ?code= facet. Codes are stored uppercase alphanumeric (the
 * customer app strips non-alphanumerics before storing), so the filter
 * normalizes the same way — "victor-k2qp9" finds "VICTORK2QP9". */
export function normalizeReferralCodeFilter(
  code?: string | null
): string | null {
  const clean = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return REFERRAL_CODE_PATTERN.test(clean) ? clean : null;
}

type ReferralViewRow = {
  id: string;
  code: string | null;
  status: string | null;
  reward_days: number | null;
  created_at: string | null;
  rewarded_at: string | null;
  revoked_at: string | null;
  referred_id: string | null;
  referred_email: string | null;
  referred_username: string | null;
  referred_full_name: string | null;
  referrer_id: string | null;
  referrer_email: string | null;
  referrer_username: string | null;
  referrer_full_name: string | null;
  referrer_code: string | null;
};

function toReferralRow(row: ReferralViewRow): ReferralRow {
  return {
    id: row.id,
    code: row.code ?? "—",
    status: (REFERRAL_STATUSES as readonly string[]).includes(row.status ?? "")
      ? (row.status as ReferralStatus)
      : "signed_up",
    rewardDays: row.reward_days ?? 0,
    createdAt: row.created_at ?? "",
    rewardedAt: row.rewarded_at,
    revokedAt: row.revoked_at,
    referred: {
      id: row.referred_id ?? "",
      email: row.referred_email,
      username: row.referred_username,
      fullName: row.referred_full_name,
    },
    referrer: {
      id: row.referrer_id ?? "",
      email: row.referrer_email,
      username: row.referrer_username,
      fullName: row.referrer_full_name,
      code: row.referrer_code,
    },
  };
}

/**
 * Referrals, newest first — one query on the admin_referrals view, every
 * filter (code / status / date range) executed in Postgres. Returns
 * { rows: [], total: 0 } when the view is not deployed yet (same degrade
 * convention as listPromos).
 */
export async function listReferrals(options?: {
  code?: string | null;
  status?: ReferralStatus | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<{ rows: ReferralRow[]; total: number }> {
  try {
    const admin = createAdminClient();
    const limit = Math.min(500, Math.max(1, options?.limit ?? 100));
    const code = normalizeReferralCodeFilter(options?.code);
    const status =
      options?.status &&
      (REFERRAL_STATUSES as readonly string[]).includes(options.status)
        ? options.status
        : null;
    const range = normalizeDateRange(options?.from, options?.to);

    let query = admin
      .from("admin_referrals")
      .select(
        "id, code, status, reward_days, created_at, rewarded_at, revoked_at, referred_id, referred_email, referred_username, referred_full_name, referrer_id, referrer_email, referrer_username, referrer_full_name, referrer_code",
        { count: "exact" }
      )
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (code) query = query.eq("code", code);
    if (status) query = query.eq("status", status);
    if (range.from) query = query.gte("created_at", isoStartOfDay(range.from));
    if (range.to) query = query.lt("created_at", isoNextDay(range.to));

    const { data, error, count } = await query;
    if (error) {
      logger.warn("referrals", "listReferrals failed", error.message);
      return { rows: [], total: 0 };
    }

    return {
      rows: ((data ?? []) as ReferralViewRow[]).map(toReferralRow),
      total: count ?? 0,
    };
  } catch (err) {
    logger.warn("referrals", "listReferrals error (non-fatal)", err);
    return { rows: [], total: 0 };
  }
}

/**
 * Per-referrer aggregates (one RPC call), optionally narrowed to a date
 * range. Returns [] when the RPC is not deployed yet — same degrade
 * convention as listPromos.
 */
export async function getReferralLeaderboard(options?: {
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<ReferralLeaderboardRow[]> {
  try {
    const admin = createAdminClient();
    const limit = Math.min(50, Math.max(1, options?.limit ?? 10));
    const range = normalizeDateRange(options?.from, options?.to);

    const { data, error } = await admin.rpc("admin_referral_leaderboard", {
      p_from: range.from,
      p_to: range.to,
    });
    if (error) {
      logger.warn("referrals", "getReferralLeaderboard failed", error.message);
      return [];
    }

    type RpcRow = {
      referrer_id: string;
      username: string | null;
      full_name: string | null;
      code: string | null;
      email: string | null;
      signups: number | string | null;
      rewards: number | string | null;
      days_awarded: number | string | null;
      last_rewarded_at: string | null;
    };
    const num = (value: unknown) => Number(value ?? 0);

    return ((data ?? []) as RpcRow[])
      .slice(0, limit)
      .map((row) => ({
        referrerId: row.referrer_id,
        username: row.username,
        fullName: row.full_name,
        code: row.code,
        email: row.email,
        signups: num(row.signups),
        rewards: num(row.rewards),
        daysAwarded: num(row.days_awarded),
        lastRewardedAt: row.last_rewarded_at,
      }));
  } catch (err) {
    logger.warn("referrals", "getReferralLeaderboard error (non-fatal)", err);
    return [];
  }
}