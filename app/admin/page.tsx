import { requireAdmin } from "@/lib/auth/guard";

/**
 * Dashboard home — Phase 1 shell.
 *
 * Real stats (users, payments, signups) arrive in Phase 2. This page proves
 * the full auth pipeline works: proxy → session → admin check → render.
 */
export default async function AdminDashboardPage() {
  const session = await requireAdmin();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {session.email.split("@")[0]}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Signed in as {session.admin?.role.display_name}. Here&apos;s the
          state of the platform.
        </p>
      </div>

      {/* Stats grid — placeholders until Phase 2 wires up real data */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value="—" note="Coming in Phase 2" />
        <StatCard label="Active cards" value="—" note="Coming in Phase 2" />
        <StatCard label="Payments (30d)" value="—" note="Coming in Phase 2" />
        <StatCard label="Pro subscribers" value="—" note="Coming in Phase 2" />
      </div>

      <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Phase 1 — complete
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          <li>✓ Supabase auth wired (email + password, no signup)</li>
          <li>✓ Proxy session refresh + optimistic route protection</li>
          <li>✓ Server-side admin authorization (admin_users gate)</li>
          <li>✓ Dashboard shell with role-aware header</li>
        </ul>
        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Next up — Phase 2
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-500">
          <li>• Real platform stats</li>
          <li>• User management (search, view, suspend)</li>
          <li>• Admin invites (server-side, service-role)</li>
        </ul>
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