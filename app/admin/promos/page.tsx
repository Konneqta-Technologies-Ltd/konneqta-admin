import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { formatDate } from "../format";
import {
  listPromoRedemptions,
  listPromos,
  normalizePromoCodeFilter,
  promoState,
  PROMO_STATUSES,
  type PromoRedemptionRow,
  type PromoRow,
  type PromoState,
} from "@/lib/admin/promos";
import { PromoActions } from "./promo-actions";
import { PromoForm } from "./promo-form";

/**
 * Promo codes management page.
 *
 * Create codes (free Premium days), see every code with its live status —
 * Active / Scheduled / Expired / Fully redeemed / Disabled — its use counter
 * and validity window, and enable/disable at will. Disabling (or the set
 * date passing) stops NEW redemptions instantly; days already redeemed stay
 * with the users until each one's personal expiry lapses.
 */
export default async function AdminPromosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; code?: string }>;
}) {
  const session = await requireAdmin();
  const canManage = await hasPermission(session, "promos.manage");
  if (!canManage) return <AccessDenied />;

  const params = await searchParams;
  // Allow-listed facets - anything bogus is ignored (no filter).
  const statusFilter = (PROMO_STATUSES as readonly string[]).includes(
    params.status ?? ""
  )
    ? (params.status as PromoState)
    : null;
  const codeFilter = normalizePromoCodeFilter(params.code);

  const [promos, redemptions] = await Promise.all([
    listPromos({ limit: 100, status: statusFilter ?? undefined }),
    // Only fetched when a code drill-down is open.
    codeFilter
      ? listPromoRedemptions({ code: codeFilter, limit: 200 })
      : Promise.resolve([] as PromoRedemptionRow[]),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Management
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Promo codes</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Codes that grant free Premium days when redeemed in the customer app
          (Settings → Promo code). Days stack on whatever a user has left, and
          every redeemer gets the full reward from their own redemption moment.
        </p>
      </div>

      {/* Status filter for the codes table. Keeps any open code drill-down. */}
      <form
        action="/admin/promos"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="code" value={codeFilter ?? ""} />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          aria-label="Filter codes by status"
        >
          <option value="">All statuses</option>
          {PROMO_STATUSES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
          Filter
        </button>
        {(statusFilter || codeFilter) && (
          <Link
            href="/admin/promos"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        )}
      </form>

      {/* ── Create form ─────────────────────────────────────────────────── */}
      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-4 text-sm font-medium">
          Create a promo code
        </div>
        <div className="p-5">
          <PromoForm />
        </div>
      </div>

      {/* ── Codes table ─────────────────────────────────────────────────── */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-4 text-sm text-zinc-400">
          {promos.length.toLocaleString()} code{promos.length === 1 ? "" : "s"}
        </div>
        {promos.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No promo codes yet. Create the first one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Code</th>
                  <th className="px-5 py-3 font-medium">Days</th>
                  <th className="px-5 py-3 font-medium">Uses</th>
                  <th className="px-5 py-3 font-medium">Window</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {promos.map((promo) => (
                  <PromoRowView key={promo.id} promo={promo} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drill-down: who redeemed the selected code (?code=). */}
      {codeFilter && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 px-5 py-4 text-sm text-zinc-400">
            {redemptions.length.toLocaleString()} redemption
            {redemptions.length === 1 ? "" : "s"} of
            <span
              className="ml-1 font-mono font-medium tracking-wider text-white"
            >
              {codeFilter}
            </span>
          </div>
          {redemptions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-zinc-500">
              No redemptions recorded for this code yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Redeemed by</th>
                    <th className="px-5 py-3 font-medium">Days granted</th>
                    <th className="px-5 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {redemptions.map((redemption) => (
                    <tr
                      key={redemption.id}
                      className="hover:bg-zinc-800/40"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={"/admin/users/" + redemption.user_id}
                          className="font-medium text-white hover:underline"
                        >
                          {redemption.full_name ||
                            redemption.username ||
                            "Unnamed user"}
                        </Link>
                        <p className="mt-1 text-xs text-zinc-500">
                          {redemption.email ?? "Unknown email"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-zinc-300">
                        +{redemption.days_granted}
                      </td>
                      <td className="px-5 py-4 text-zinc-400">
                        {formatDate(redemption.redeemed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PromoRowView({ promo }: { promo: PromoRow }) {
  const state = promoState(promo);
  return (
    <tr className="hover:bg-zinc-800/40">
      <td className="px-5 py-4 font-mono font-medium tracking-wider text-white">
        {promo.code}
      </td>
      <td className="px-5 py-4 text-zinc-300">+{promo.reward_days}</td>
      <td className="px-5 py-4 text-zinc-300">
        <Link
          href={"/admin/promos?code=" + promo.code}
          className="font-medium text-white hover:underline"
          title="See who redeemed this code"
        >
          {promo.uses}
        </Link>
        {promo.max_uses === null ? (
          <span className="text-zinc-500"> / ∞</span>
        ) : (
          <span className="text-zinc-500"> / {promo.max_uses}</span>
        )}
      </td>
      <td className="px-5 py-4 text-zinc-400">
        {formatDate(promo.valid_from)} → {promo.valid_until ? formatDate(promo.valid_until) : "∞"}
      </td>
      <td className="px-5 py-4 text-zinc-400">{promo.description ?? "—"}</td>
      <td className="px-5 py-4">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${stateChipColor(state)}`}
        >
          {state}
        </span>
      </td>
      <td className="px-5 py-4">
        <PromoActions id={promo.id} code={promo.code} active={promo.active} />
      </td>
    </tr>
  );
}

function stateChipColor(state: string): string {
  switch (state) {
    case "Active":
      return "bg-emerald-950 text-emerald-300";
    case "Scheduled":
      return "bg-sky-950 text-sky-300";
    case "Expired":
    case "Fully redeemed":
      return "bg-zinc-800 text-zinc-400";
    default:
      return "bg-red-950 text-red-300";
  }
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to manage promo codes.
    </div>
  );
}
