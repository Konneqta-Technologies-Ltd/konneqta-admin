import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { UserStatusButton } from "../user-actions";
import { GrantProPanel } from "./grant-pro-panel";
import { formatDate } from "../../format";
import { getCustomerUser } from "@/lib/admin/data";
import { grantState, listGrants, proState } from "@/lib/admin/grants";
import { notFound } from "next/navigation";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "users.read"))) {
    return (
      <p className="text-sm text-red-200">
        You do not have permission to view this user.
      </p>
    );
  }

  const { id } = await params;
  const user = await getCustomerUser(id);
  if (!user) notFound();
  const canUpdate = await hasPermission(session, "users.update");
  const canGrantPro = await hasPermission(session, "users.grant_pro");

  // Effective Pro state (mirrors the customer app's lazy isPro() expiry).
  const { isPro: isProEffective, daysLeft } = proState({
    plan: user.plan,
    is_exempt: user.isExempt,
    pro_expires_at: user.proExpiresAt,
  });

  const grants = await listGrants({ userId: id, limit: 20 });

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/users" className="text-sm text-zinc-400 hover:text-white">
        ← Back to users
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Customer profile
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {user.fullName || user.username || "Unnamed user"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">{user.email}</p>
        </div>
        {canUpdate && <UserStatusButton id={user.id} status={user.status} />}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Detail label="User ID" value={user.id} mono />
        <Detail label="Username" value={user.username ?? "—"} />
        <Detail
          label="Plan"
          value={user.isExempt ? "Pro exempt" : user.plan}
        />
        <Detail label="Pro expiry" value={formatDate(user.proExpiresAt)} />
        <Detail label="Cards" value={String(user.cardCount)} />
        <Detail label="Joined" value={formatDate(user.createdAt)} />
        <Detail
          label="Account status"
          value={user.status[0].toUpperCase() + user.status.slice(1)}
        />
      </div>

      {canGrantPro && (
        <div className="mt-4">
          <GrantProPanel
            userId={user.id}
            isExempt={user.isExempt}
            isPro={isProEffective}
            daysLeft={daysLeft}
          />
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-white">Grant history</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Complimentary Pro grants recorded for this user.
        </p>
        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          {grants.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">
              No grants recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Granted</th>
                    <th className="px-5 py-3 font-medium">Days</th>
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
                        <td className="px-5 py-3.5 text-zinc-400">
                          {formatDate(grant.created_at)}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-300">
                          {grant.days}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-300">
                          {formatDate(grant.expires_at)}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-400">
                          {grant.note ?? "—"}
                        </td>
                        <td className="px-5 py-3.5">
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
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-2 break-all text-sm text-zinc-100 ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}