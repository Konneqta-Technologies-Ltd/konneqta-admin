import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { formatCurrency } from "../format";
import {
  fetchMonthlyReport,
  formatReportText,
  parseMonthParam,
  pctLabel,
  previousMonthRange,
} from "@/lib/admin/monthly-report";
import { SendReportButton } from "./send-report-button";

/**
 * Reports page — any past month's platform digest, same data the monthly
 * email carries (admin_monthly_report RPC). Super admins also get a
 * "Send now" button that emails it immediately.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "users.read"))) return <AccessDenied />;
  const isSuperAdmin = session.admin?.role.name === "super_admin";

  const params = await searchParams;
  const range = parseMonthParam(params.month) ?? previousMonthRange();

  let report = null;
  let loadError: string | null = null;
  try {
    report = await fetchMonthlyReport(range.from, range.to);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "The report could not be loaded.";
  }

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Communication
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Monthly report — {range.label}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        The full platform digest for {range.from} → {range.to} (UTC,
        end-exclusive) — the same content the cron emails on the 1st.
      </p>

      <form action="/admin/reports" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="month"
          name="month"
          defaultValue={range.from.slice(0, 7)}
          aria-label="Report month"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
        />
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
          View
        </button>
        <Link
          href="/admin/reports"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Latest
        </Link>
        {isSuperAdmin && (
          <span className="ml-auto">
            <SendReportButton month={range.from.slice(0, 7)} />
          </span>
        )}
      </form>

      {loadError && (
        <div className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-6 text-sm text-amber-200">
          {loadError} — has{" "}
          <code className="font-mono">supabase/admin-data-views.sql</code> been
          re-run in Supabase?
        </div>
      )}

      {report && (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="1. New signups" value={String(report.users.new)} sub={`${pctLabel(report.users.newGrowthPct)} vs previous month`} />
            <Stat label="Total users" value={String(report.users.total)} sub={`${report.users.suspended} suspended · ${report.users.deactivated} deactivated`} />
            <Stat label="2. Revenue" value={formatCurrency(report.revenue.total)} sub={`${pctLabel(report.revenue.totalGrowthPct)} vs previous month`} />
            <Stat label="Successful payments" value={String(report.revenue.count)} sub={`avg ${formatCurrency(report.revenue.avgPerPayment)} · ${report.revenue.premiumCount} premium · ${report.revenue.teamsCount} teams`} />
            <Stat label="Failed payments" value={String(report.revenue.failed)} sub="verify on the Flutterwave dashboard" />
            <Stat label="3. Active Pro at end" value={String(report.pro.activeEnd)} sub={`${report.pro.newConversions} new conversions · ${report.pro.expired} expired`} />
            <Stat label="Complimentary grants" value={String(report.pro.grants)} sub={`${report.pro.grantsDays} days granted`} />
            <Stat label="4. Referral signups" value={String(report.referrals.attached)} sub={`${report.referrals.converted} converted (rewards paid)`} />
            <Stat label="5. Promo redemptions" value={String(report.promos.redemptions)} />
            <Stat label="6. Cards created" value={report.engagement.cardsCreated === null ? "—" : String(report.engagement.cardsCreated)} sub={`${report.engagement.profileViews === null ? "—" : report.engagement.profileViews} profile views · ${report.engagement.konneqts === null ? "—" : report.engagement.konneqts} konneqts`} />
            <Stat label="7. Admin actions" value={String(report.adminActions)} sub="audited in the audit log" />
          </section>

          {report.referrals.top.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-white">Top referrers</h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Referrer</th>
                        <th className="px-5 py-3 font-medium">Code</th>
                        <th className="px-5 py-3 font-medium">Signups</th>
                        <th className="px-5 py-3 font-medium">Conversions</th>
                        <th className="px-5 py-3 font-medium">Days awarded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {report.referrals.top.map((row) => (
                        <tr key={row.username ?? row.code} className="hover:bg-zinc-800/40">
                          <td className="px-5 py-3 text-zinc-200">{row.username ?? "—"}</td>
                          <td className="px-5 py-3 font-mono text-xs text-white">{row.code ?? "—"}</td>
                          <td className="px-5 py-3 text-zinc-300">{row.signups}</td>
                          <td className="px-5 py-3 text-zinc-300">{row.rewards}</td>
                          <td className="px-5 py-3 text-zinc-300">+{row.daysAwarded}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {report.promos.top.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-white">Top promo codes</h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Code</th>
                        <th className="px-5 py-3 font-medium">Redemptions</th>
                        <th className="px-5 py-3 font-medium">Days granted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {report.promos.top.map((row) => (
                        <tr key={row.code ?? "—"} className="hover:bg-zinc-800/40">
                          <td className="px-5 py-3 font-mono text-xs text-white">{row.code ?? "—"}</td>
                          <td className="px-5 py-3 text-zinc-300">{row.redemptions}</td>
                          <td className="px-5 py-3 text-zinc-300">{row.daysGranted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {report && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-white">
            Plain-text version (for logs)
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-xs leading-relaxed text-zinc-300">
            {formatReportText(report)}
          </pre>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to view reports.
    </div>
  );
}