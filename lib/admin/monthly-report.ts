import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Monthly platform report — stats for the end-of-month digest email AND the
 * /admin/reports page, from ONE RPC (admin_monthly_report). Pure helpers
 * (month math, growth %, formatting) are exported for unit tests; the HTML
 * email builder is pure too so the digest content can be pinned by tests.
 */

export type MonthlyReport = {
  from: string;
  to: string;
  /** Human label of the reporting month, e.g. "October 2026". */
  label: string;
  users: {
    new: number;
    prevNew: number;
    newGrowthPct: number | null;
    total: number;
    suspended: number;
    deactivated: number;
  };
  revenue: {
    count: number;
    total: number;
    prevTotal: number;
    totalGrowthPct: number | null;
    failed: number;
    premiumCount: number;
    teamsCount: number;
    avgPerPayment: number;
  };
  pro: {
    activeEnd: number;
    newConversions: number;
    expired: number;
    grants: number;
    grantsDays: number;
  };
  referrals: {
    attached: number;
    converted: number;
    top: Array<{
      username: string | null;
      code: string | null;
      signups: number;
      rewards: number;
      daysAwarded: number;
    }>;
  };
  promos: {
    redemptions: number;
    top: Array<{ code: string | null; redemptions: number; daysGranted: number }>;
  };
  engagement: {
    cardsCreated: number | null;
    profileViews: number | null;
    konneqts: number | null;
  };
  adminActions: number;
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-01" → "October 2026" (UTC, so it never drifts by server TZ). */
export function monthLabel(from: string): string {
  return MONTH_LABEL.format(new Date(`${from}T00:00:00Z`));
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The report window the cron sends: the PREVIOUS calendar month
 * [first day, first day of current month). Pure in `now` for tests.
 */
export function previousMonthRange(now: Date = new Date()): {
  from: string;
  to: string;
  label: string;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; current month
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from: isoDay(from), to: isoDay(to), label: monthLabel(isoDay(from)) };
}

/**
 * Parse a ?month=YYYY-MM facet into its report window. Anything bogus is
 * null (= caller falls back to previousMonthRange), so a malformed URL can
 * never widen or break the RPC.
 */
export function parseMonthParam(
  param?: string | null,
  now: Date = new Date()
): { from: string; to: string; label: string } | null {
  if (!param || !/^\d{4}-\d{2}$/.test(param.trim())) return null;
  const [yearRaw, monthRaw] = param.trim().split("-");
  const year = Number(yearRaw);
  const monthIdx = Number(monthRaw) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  // Reject months in the future (no report exists yet) — fall back.
  const from = new Date(Date.UTC(year, monthIdx, 1));
  const to = new Date(Date.UTC(year, monthIdx + 1, 1));
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  if (from >= currentMonthStart) return null;
  return { from: isoDay(from), to: isoDay(to), label: monthLabel(isoDay(from)) };
}

/**
 * Month-over-month growth percentage (1 decimal). null when the previous
 * window had nothing to compare against (rendered as "—" / "new").
 */
export function growthPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** ₦ formatting for the report (whole naira — payments are NGN). */
export function formatNaira(value: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);
}

const num = (value: unknown): number => Number(value ?? 0);

const section = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const maybeNum = (value: unknown): number | null =>
  value === undefined || value === null ? null : Number(value);

function mapTop(
  value: unknown
): Array<{
  username: string | null;
  code: string | null;
  signups: number;
  rewards: number;
  daysAwarded: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const r = section(row);
    return {
      username: typeof r.username === "string" ? r.username : null,
      code: typeof r.code === "string" ? r.code : null,
      signups: num(r.signups),
      rewards: num(r.rewards),
      daysAwarded: num(r.days_awarded),
    };
  });
}

function mapPromoTop(
  value: unknown
): Array<{ code: string | null; redemptions: number; daysGranted: number }> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const r = section(row);
    return {
      code: typeof r.code === "string" ? r.code : null,
      redemptions: num(r.redemptions),
      daysGranted: num(r.days_granted),
    };
  });
}

/**
 * Fetch the report for [from, to) — ONE RPC call. Throws when the RPC is
 * missing (callers decide whether to degrade); the JSON shape is mapped
 * defensively so a NULL/absent subtree can never crash the page or email.
 */
export async function fetchMonthlyReport(
  from: string,
  to: string
): Promise<MonthlyReport> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_monthly_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`admin_monthly_report failed: ${error.message}`);

  const raw = section(Array.isArray(data) ? data[0] : data);
  const users = section(raw.users);
  const revenue = section(raw.revenue);
  const pro = section(raw.pro);
  const referrals = section(raw.referrals);
  const promos = section(raw.promos);
  const engagement = section(raw.engagement);

  const count = num(revenue.count);
  const total = num(revenue.total);

  return {
    from,
    to,
    label: monthLabel(from),
    users: {
      new: num(users.new),
      prevNew: num(users.prev_new),
      newGrowthPct: growthPct(num(users.new), num(users.prev_new)),
      total: num(users.total),
      suspended: num(users.suspended),
      deactivated: num(users.deactivated),
    },
    revenue: {
      count,
      total,
      prevTotal: num(revenue.prev_total),
      totalGrowthPct: growthPct(total, num(revenue.prev_total)),
      failed: num(revenue.failed),
      premiumCount: num(revenue.premium_count),
      teamsCount: num(revenue.teams_count),
      avgPerPayment: count > 0 ? Math.round(total / count) : 0,
    },
    pro: {
      activeEnd: num(pro.active_end),
      newConversions: num(pro.new_conversions),
      expired: num(pro.expired),
      grants: num(pro.grants),
      grantsDays: num(pro.grants_days),
    },
    referrals: {
      attached: num(referrals.attached),
      converted: num(referrals.converted),
      top: mapTop(referrals.top),
    },
    promos: {
      redemptions: num(promos.redemptions),
      top: mapPromoTop(promos.top),
    },
    engagement: {
      cardsCreated: maybeNum(engagement.cards_created),
      profileViews: maybeNum(engagement.profile_views),
      konneqts: maybeNum(engagement.konneqts),
    },
    adminActions: num(raw.admin_actions),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "+12.5%" / "-3%" / "—" (no previous month to compare). */
export function pctLabel(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value}%`;
}

const KV_ROW = "padding:4px 0;color:#3f3f46;font-size:14px;";
const KV_LABEL = "color:#71717a;";

function kvRows(rows: Array<[string, string]>): string {
  return rows
    .map(
      ([label, value]) =>
        `<tr><td style="${KV_LABEL} ${KV_ROW}">${escapeHtml(label)}</td><td style="${KV_ROW}text-align:right;font-weight:600;">${escapeHtml(value)}</td></tr>`
    )
    .join("");
}

function sectionHtml(title: string, inner: string): string {
  return `<h3 style="margin:24px 0 8px;font-size:15px;color:#101010;">${escapeHtml(title)}</h3>${inner}`;
}

function topTable(headers: string[], rows: string[][]): string {
  const head = headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #e4e4e7;color:#71717a;font-weight:500;font-size:12px;">${escapeHtml(h)}</th>`
    )
    .join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (c) =>
              `<td style="padding:6px 10px;border-bottom:1px solid #f4f4f5;color:#3f3f46;font-size:13px;">${escapeHtml(c)}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;"><tr>${head}</tr>${body}</table>`;
}

/**
 * The digest email body — pure, inline-styled (email clients strip CSS
 * classes), section numbering mirrors formatReportText.
 */
export function formatReportEmailHtml(report: MonthlyReport): string {
  const topReferrals = report.referrals.top.length
    ? topTable(
        ["Referrer", "Code", "Signups", "Conversions", "Days awarded"],
        report.referrals.top.map((r) => [
          r.username ?? "—",
          r.code ?? "—",
          String(r.signups),
          String(r.rewards),
          String(r.daysAwarded),
        ])
      )
    : `<p style="${KV_ROW}">No referral activity this month.</p>`;

  const topPromos = report.promos.top.length
    ? topTable(
        ["Code", "Redemptions", "Days granted"],
        report.promos.top.map((r) => [
          r.code ?? "—",
          String(r.redemptions),
          String(r.daysGranted),
        ])
      )
    : `<p style="${KV_ROW}">No promo redemptions this month.</p>`;

  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;">
  <h2 style="margin:0 0 4px;font-size:20px;color:#101010;">Konneqta — ${escapeHtml(report.label)} report</h2>
  <p style="margin:0 0 16px;color:#71717a;font-size:13px;">${escapeHtml(report.from)} → ${escapeHtml(report.to)} (UTC, end-exclusive) · Konneqta Admin</p>

  ${sectionHtml("1. Signups", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["New signups", `${report.users.new} (${pctLabel(report.users.newGrowthPct)} vs previous month)`],
    ["Total users", String(report.users.total)],
    ["Suspended (auth ban)", String(report.users.suspended)],
    ["Deactivated", String(report.users.deactivated)],
  ])}</table>`)}

  ${sectionHtml("2. Revenue", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["Revenue", `${formatNaira(report.revenue.total)} (${pctLabel(report.revenue.totalGrowthPct)} vs previous month)`],
    ["Successful payments", String(report.revenue.count)],
    ["Average per payment", formatNaira(report.revenue.avgPerPayment)],
    ["Premium upgrades", String(report.revenue.premiumCount)],
    ["Team subscriptions", String(report.revenue.teamsCount)],
    ["Failed payments", String(report.revenue.failed)],
  ])}</table>`)}

  ${sectionHtml("3. Pro", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["Active Pro at month end", String(report.pro.activeEnd)],
    ["New conversions (first payment)", String(report.pro.newConversions)],
    ["Pro windows expired", String(report.pro.expired)],
    ["Complimentary grants", `${report.pro.grants} (${report.pro.grantsDays} days)`],
  ])}</table>`)}

  ${sectionHtml("4. Referrals", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["New signups via referral code", String(report.referrals.attached)],
    ["Referral conversions (rewards paid)", String(report.referrals.converted)],
  ])}</table>${topReferrals}`)}

  ${sectionHtml("5. Promo codes", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["Redemptions", String(report.promos.redemptions)],
  ])}</table>${topPromos}`)}

  ${sectionHtml("6. Engagement", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["Cards created", report.engagement.cardsCreated === null ? "—" : String(report.engagement.cardsCreated)],
    ["Profile views", report.engagement.profileViews === null ? "—" : String(report.engagement.profileViews)],
    ["Konneqts", report.engagement.konneqts === null ? "—" : String(report.engagement.konneqts)],
  ])}</table>`)}

  ${sectionHtml("7. Admin activity", `<table style="border-collapse:collapse;width:100%;">${kvRows([
    ["Audited admin actions", String(report.adminActions)],
  ])}</table>`)}

  <p style="margin-top:28px;color:#a1a1aa;font-size:12px;">Full drill-downs: Konneqta Admin → Referrals · Broadcast · Reports.</p>
</div>`;
}

/** Plain-text twin of the HTML digest (logs, previewing, fallback). */
export function formatReportText(report: MonthlyReport): string {
  const lines = [
    `Konneqta — ${report.label} report (${report.from} → ${report.to} UTC)`,
    "",
    `1. Signups: ${report.users.new} new (${pctLabel(report.users.newGrowthPct)} MoM), ${report.users.total} total, ${report.users.suspended} suspended, ${report.users.deactivated} deactivated`,
    `2. Revenue: ${formatNaira(report.revenue.total)} from ${report.revenue.count} payments (${pctLabel(report.revenue.totalGrowthPct)} MoM), avg ${formatNaira(report.revenue.avgPerPayment)}, ${report.revenue.failed} failed`,
    `3. Pro: ${report.pro.activeEnd} active at end, ${report.pro.newConversions} new conversions, ${report.pro.expired} expired, ${report.pro.grants} grants (${report.pro.grantsDays} days)`,
    `4. Referrals: ${report.referrals.attached} attached, ${report.referrals.converted} converted`,
    ...report.referrals.top.map(
      (r) =>
        `   - ${r.username ?? "—"} (${r.code ?? "—"}): ${r.signups} signups, ${r.rewards} conversions, +${r.daysAwarded}d`
    ),
    `5. Promos: ${report.promos.redemptions} redemptions`,
    ...report.promos.top.map(
      (r) =>
        `   - ${r.code ?? "—"}: ${r.redemptions} redemptions, ${r.daysGranted}d granted`
    ),
    `6. Engagement: ${report.engagement.cardsCreated ?? "—"} cards, ${report.engagement.profileViews ?? "—"} profile views, ${report.engagement.konneqts ?? "—"} konneqts`,
    `7. Admin actions: ${report.adminActions}`,
  ];
  return lines.join("\n");
}