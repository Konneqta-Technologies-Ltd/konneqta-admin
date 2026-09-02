import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { UserStatusButton } from "./user-actions";
import { formatDate } from "../format";
import {
  buildCustomerUserFilters,
  getCustomerUsers,
} from "@/lib/admin/data";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    plan?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const session = await requireAdmin();
  const canRead = await hasPermission(session, "users.read");
  if (!canRead) return <AccessDenied />;

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  // Allow-listed facets — anything bogus falls back to "all" (no filter).
  const { plan: planFilter, status: statusFilter } = buildCustomerUserFilters(
    params.plan,
    params.status
  );
  const hasFilters = Boolean(query || planFilter || statusFilter);
  const requestedPage = Math.max(
    1,
    Number.parseInt(params.page ?? "1", 10) || 1
  );
  const canUpdate = await hasPermission(session, "users.update");

  let result = await getCustomerUsers(query, requestedPage, undefined, {
    plan: planFilter,
    status: statusFilter,
  });
  // A stale ?page= beyond the last page (e.g. after a search narrowed the
  // results) — clamp to the last real page and re-fetch once.
  const totalPages = Math.max(1, Math.ceil(result.total / result.perPage));
  if (result.page > totalPages) {
    result = await getCustomerUsers(query, totalPages, undefined, {
      plan: planFilter,
      status: statusFilter,
    });
  }
  const { users, total, page, perPage } = result;

  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (planFilter) search.set("plan", planFilter);
    if (statusFilter) search.set("status", statusFilter);
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Management
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Customer users
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Search profiles, inspect account state, and manage public access.
          </p>
        </div>
        <form
          className="flex w-full max-w-xl flex-wrap gap-2 sm:w-auto"
          action="/admin/users"
        >
          <input
            type="hidden"
            name="page"
            value="1"
          />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search email, username, or name"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 sm:w-64"
          />
          <select
            name="plan"
            defaultValue={planFilter ?? ""}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
            aria-label="Filter by plan"
          >
            <option value="">All plans</option>
            <option value="pro">Pro (now)</option>
            <option value="free">Free</option>
            <option value="exempt">Pro exempt</option>
          </select>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
            <option value="suspended">Suspended</option>
          </select>
          <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
            Search
          </button>
        </form>
      </div>

      {hasFilters && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-zinc-500">
            Filtered
            {planFilter && (
              <>
                {" — plan: "}
                <span className="font-medium text-zinc-300">{planFilter}</span>
              </>
            )}
            {statusFilter && (
              <>
                {" — status: "}
                <span className="font-medium text-zinc-300">
                  {statusFilter}
                </span>
              </>
            )}
            {query && (
              <>
                {" — search: "}
                <span className="font-medium text-zinc-300">“{query}”</span>
              </>
            )}
          </span>
          <Link
            href="/admin/users"
            className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-4 text-sm text-zinc-400">
          {total.toLocaleString()} matching user{total === 1 ? "" : "s"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Cards</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-zinc-800/40">
                  <td className="px-5 py-4">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="font-medium text-white hover:underline"
                    >
                      {user.fullName || user.username || "Unnamed user"}
                    </Link>
                    <p className="mt-1 text-xs text-zinc-500">{user.email}</p>
                  </td>
                  <td className="px-5 py-4 capitalize text-zinc-300">
                    {user.isExempt ? "Pro exempt" : user.plan}
                  </td>
                  <td className="px-5 py-4 text-zinc-300">
                    {user.cardCount}
                  </td>
                  <td className="px-5 py-4 text-zinc-400">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    {canUpdate && (
                      <UserStatusButton id={user.id} status={user.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No users match this search.
          </p>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          perPage={perPage}
          hrefFor={pageHref}
        />
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  perPage,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-800 px-5 py-3 text-sm">
      <p className="text-zinc-500">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            ← Previous
          </Link>
        ) : (
          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600">
            ← Previous
          </span>
        )}
        <span className="text-xs text-zinc-400">
          Page {page.toLocaleString()} of {totalPages.toLocaleString()}
        </span>
        {page < totalPages ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600">
            Next →
          </span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "active" | "deactivated" | "suspended";
}) {
  const styles = {
    active: "bg-emerald-950 text-emerald-300",
    deactivated: "bg-amber-950 text-amber-300",
    suspended: "bg-red-950 text-red-300",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to view customer users.
    </div>
  );
}
