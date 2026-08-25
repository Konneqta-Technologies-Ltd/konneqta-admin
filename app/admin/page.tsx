import { formatCurrency, formatDate } from "./format";
import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import { getDashboardStats } from "@/lib/admin/data";

export default async function AdminDashboardPage() {
  const session = await requireAdmin();
  const canReadPayments = await hasPermission(session, "payments.read");
  const stats = await getDashboardStats(canReadPayments);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Platform overview
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Welcome back, {session.email.split("@")[0]}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as {session.admin?.role.display_name}. Here&apos;s the
            current state of the platform.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={stats.totalUsers.toLocaleString()}
          note="All profiles"
        />
        <StatCard
          label="Active cards"
          value={stats.activeCards.toLocaleString()}
          note="Cards on the platform"
        />
        <StatCard
          label="Payments (30d)"
          value={canReadPayments ? stats.payments30d.toLocaleString() : "Hidden"}
          note={
            canReadPayments
              ? formatCurrency(stats.paymentRevenue30d)
              : "Requires payments.read"
          }
        />
        <StatCard
          label="Pro subscribers"
          value={stats.proSubscribers.toLocaleString()}
          note="Active subscriptions"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Recent signups</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Newest accounts created in Supabase Auth.
              </p>
            </div>
            <span className="text-sm font-medium text-zinc-400">
              {stats.deactivatedUsers} deactivated
            </span>
          </div>
          <div className="mt-5 divide-y divide-zinc-800">
            {stats.recentSignups.map((signup) => (
              <div
                key={signup.id}
                className="flex items-center justify-between gap-4 py-3 text-sm"
              >
                <span className="truncate text-zinc-200">{signup.email}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatDate(signup.createdAt)}
                </span>
              </div>
            ))}
            {stats.recentSignups.length === 0 && (
              <p className="py-4 text-sm text-zinc-500">No signups found.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-base font-semibold">Operational signals</h2>
          <div className="mt-5 space-y-4">
            <Signal
              label="Users with public access"
              value={(stats.totalUsers - stats.deactivatedUsers).toLocaleString()}
            />
            <Signal
              label="Deactivated profiles"
              value={stats.deactivatedUsers.toLocaleString()}
            />
            <Signal
              label="Payment visibility"
              value={canReadPayments ? "Enabled" : "Restricted"}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 pb-3 text-sm last:border-0 last:pb-0">
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold text-zinc-100">{value}</span>
    </div>
  );
}