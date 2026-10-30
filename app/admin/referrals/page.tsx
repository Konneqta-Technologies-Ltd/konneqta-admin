import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { formatDate } from "../format";
import {
  getReferralLeaderboard,
  listReferrals,
  normalizeDateRange,
  normalizeReferralCodeFilter,
  REFERRAL_STATUSES,
  type ReferralRow,
  type ReferralStatus,
} from "@/lib/admin/referrals";

/**
 * Referrals page — "who signed up with which code" (and who converted).
 * Code/status/date-range facets all run in Postgres; the date range also
 * drives the leaderboard so it answers "who drove signups this month".
 */
export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "users.read"))) return <AccessDenied />;

  const params = await searchParams;
  // Allow-listed facets — anything bogus is ignored (no filter).
  const codeFilter = normalizeReferralCodeFilter(params.code);
  const statusFilter = (REFERRAL_STATUSES as readonly string[]).includes(
    params.status ?? ""
  )
    ? (params.status as ReferralStatus)
    : null;
  const range = normalizeDateRange(params.from, params.to);
  const hasRange = Boolean(range.from || range.to);

  const [list, leaderboard] = await Promise.all([
    listReferrals({
      code: codeFilter,
      status: statusFilter,
      from: range.from,
      to: range.to,
      limit: 200,
    }),
    getReferralLeaderboard({ from: range.from, to: range.to, limit: 10 }),
  ]);

  // Quick range presets — plain links so filtered views are shareable.
  const today = new Date();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );
  const lastMonthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)
  );
  const presets = [
    { label: "This month", href: `/admin/referrals?from=${iso(monthStart)}&to=${iso(today)}` },
    { label: "Last month", href: `/admin/referrals?from=${iso(lastMonthStart)}&to=${iso(monthStart)}` },
    { label: "Last 30 days", href: `/admin/referrals?from=${iso(new Date(today.getTime() - 30 * 86_400_000))}&to=${iso(today)}` },
    { label: "All time", href: "/admin/referrals" },
  ];
  const hasFilters = Boolean(codeFilter || statusFilter || hasRange);

  return (
    <div className="mx-auto max-w-7xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Growth
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Referrals</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Everyone who signed up with a referral code, and whose first payment
        rewarded the referrer. The {list.total} referral
        {list.total === 1 ? "" : "s"}
        {hasFilters ? " matching the filters below." : " on record."}
      </p>

      {/* Quick ranges */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <Link
            key={preset.label}
            href={preset.href}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            {preset.label}
          </Link>
        ))}
      </div>

      {/* Filters: code / status / attached-date range (all Postgres-side) */}
      <form action="/admin/referrals" className="mt-3 flex flex-wrap items-center gap-2">
        <input
          name="code"
          defaultValue={params.code ?? ""}
          placeholder="Referral code contains…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 sm:w-56"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {REFERRAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={range.from ?? ""} aria-label="Attached from" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400" />
        <input type="date" name="to" defaultValue={range.to ?? ""} aria-label="Attached to" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400" />
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
          Filter
        </button>
        {hasFilters && (
          <Link href="/admin/referrals" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
            Clear
          </Link>
        )}
      </form>

      {leaderboard.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-white">
            Top referrers{hasRange ? " (in range)" : ""}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Signups are codes attached in range; conversions are rewards paid
            in range. With a range set, referrers with any in-range activity
            still appear.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Referrer</th>
                    <th className="px-5 py-3 font-medium">Code</th>
                    <th className="px-5 py-3 font-medium">Signups</th>
                    <th className="px-5 py-3 font-medium">Conversions</th>
                    <th className="px-5 py-3 font-medium">Days awarded</th>
                    <th className="px-5 py-3 font-medium">Last conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {leaderboard.map((row) => (
                    <tr key={row.referrerId} className="hover:bg-zinc-800/40">
                      <td className="px-5 py-4">
                        <Link
                          href={"/admin/users/" + row.referrerId}
                          className="font-medium text-white hover:underline"
                        >
                          {row.fullName || row.username || "Unnamed user"}
                        </Link>
                        <p className="mt-1 text-xs text-zinc-500">
                          {row.email ?? "Unknown email"}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs tracking-wider text-white">
                        {row.code ?? "—"}
                      </td>
                      <td className="px-5 py-4 text-zinc-300">{row.signups}</td>
                      <td className="px-5 py-4 text-zinc-300">{row.rewards}</td>
                      <td className="px-5 py-4 text-zinc-300">+{row.daysAwarded}</td>
                      <td className="px-5 py-4 text-zinc-400">
                        {formatDate(row.lastRewardedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Referred user</th>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Reward</th>
                <th className="px-5 py-3 font-medium">Attached</th>
                <th className="px-5 py-3 font-medium">Converted</th>
                <th className="px-5 py-3 font-medium">Referrer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {list.rows.map((referral) => (
                <ReferralRowView key={referral.id} referral={referral} />
              ))}
            </tbody>
          </table>
        </div>
        {list.rows.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            {hasFilters
              ? "No referrals match these filters."
              : "No referrals have been recorded yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: ReferralStatus): string {
  switch (status) {
    case "signed_up":
      return "Signed up";
    case "rewarded":
      return "Rewarded";
    case "revoked":
      return "Revoked";
  }
}

function statusChipColor(status: ReferralStatus): string {
  switch (status) {
    case "rewarded":
      return "bg-emerald-950 text-emerald-300";
    case "revoked":
      return "bg-red-950 text-red-300";
    default:
      return "bg-zinc-800 text-zinc-400";
  }
}

function ReferralRowView({ referral }: { referral: ReferralRow }) {
  return (
    <tr className="hover:bg-zinc-800/40">
      <td className="px-5 py-4">
        <Link
          href={"/admin/users/" + referral.referred.id}
          className="font-medium text-white hover:underline"
        >
          {referral.referred.fullName || referral.referred.username || "Unnamed user"}
        </Link>
        <p className="mt-1 text-xs text-zinc-500">
          {referral.referred.email ?? "Unknown email"}
        </p>
      </td>
      <td className="px-5 py-4">
        <Link
          href={"/admin/referrals?code=" + referral.code}
          className="font-mono text-xs tracking-wider text-white hover:underline"
          title="See everyone who used this code"
        >
          {referral.code}
        </Link>
      </td>
      <td className="px-5 py-4">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusChipColor(referral.status)}`}
        >
          {statusLabel(referral.status)}
        </span>
      </td>
      <td className="px-5 py-4 text-zinc-300">
        {referral.status === "signed_up" ? (
          <span className="text-xs text-zinc-500">Awaiting 1st payment</span>
        ) : referral.rewardDays > 0 ? (
          `+${referral.rewardDays}`
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
        {formatDate(referral.createdAt)}
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
        {formatDate(referral.rewardedAt)}
      </td>
      <td className="px-5 py-4">
        <Link
          href={"/admin/users/" + referral.referrer.id}
          className="text-zinc-300 hover:text-white hover:underline"
        >
          {referral.referrer.username ?? "—"}
        </Link>
        <p className="mt-1 text-xs text-zinc-500">
          {referral.referrer.email ?? "Unknown email"}
        </p>
      </td>
    </tr>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to view referrals.
    </div>
  );
}