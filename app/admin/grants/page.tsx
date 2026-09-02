import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { formatDate } from "../format";
import {
  grantState,
  GRANT_STATUS_FILTERS,
  listGrants,
  type GrantStatusFilter,
} from "@/lib/admin/grants";

export default async function AdminGrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireAdmin();
  const canRead = await hasPermission(session, "users.grant_pro");
  if (!canRead) return <AccessDenied />;

  const params = await searchParams;
  // Allow-listed facet - anything bogus is ignored (no filter).
  const statusFilter = (
    GRANT_STATUS_FILTERS as readonly string[]
  ).includes(params.status ?? "")
    ? (params.status as GrantStatusFilter)
    : null;

  const grants = await listGrants({
    limit: 100,
    status: statusFilter ?? undefined,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Management
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Complimentary Pro grants
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every no-payment Pro grant across the platform. Grant or revoke from
          a customer&apos;s profile page.
        </p>
      </div>

      {/* Status filter for the grants table. */}
      <form
        action="/admin/grants"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          aria-label="Filter grants by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
          Filter
        </button>
        {statusFilter && (
          <Link
            href="/admin/grants"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-4 text-sm text-zinc-400">
          {grants.length.toLocaleString()} grant{grants.length === 1 ? "" : "s"}
        </div>
        {grants.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No grants recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Days</th>
                  <th className="px-5 py-3 font-medium">Granted</th>
                  <th className="px-5 py-3 font-medium">Expires</th>
                  <th className="px-5 py-3 font-medium">Note</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {grants.map((grant) => {
                  const state = grantState(grant);
                  return (
                    <tr key={grant.id} className="hover:bg-zinc-800/40">
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/users/${grant.user_id}`}
                          className="font-medium text-white hover:underline"
                        >
                          @{grant.username || "unknown"}
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-zinc-300">{grant.days}</td>
                      <td className="px-5 py-4 text-zinc-400">
                        {formatDate(grant.created_at)}
                      </td>
                      <td className="px-5 py-4 text-zinc-300">
                        {formatDate(grant.expires_at)}
                      </td>
                      <td className="px-5 py-4 text-zinc-400">
                        {grant.note ?? "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            state === "Active"
                              ? "bg-emerald-950 text-emerald-300"
                              : state === "Revoked"
                                ? "bg-red-950 text-red-300"
                                : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {state}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to view Pro grants.
    </div>
  );
}
