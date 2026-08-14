import { LogoutButton } from "./logout-button";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * Dashboard layout — server-side admin gate.
 *
 * requireAdmin() redirects to /login unless the visitor is an authenticated,
 * ACTIVE admin. Every page under /admin inherits this protection.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-zinc-800 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-base font-black text-zinc-950">
            K
          </div>
          <span className="text-sm font-semibold tracking-tight">
            Konneqta Admin
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {/* Phase 1: dashboard only. /admin/users etc. arrive in Phase 2. */}
          <span className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Overview
          </span>
          <span className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white">
            Dashboard
          </span>

          <span className="mt-4 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Management
          </span>
          <span className="rounded-lg px-3 py-2 text-sm text-zinc-600">
            Users (soon)
          </span>
          <span className="rounded-lg px-3 py-2 text-sm text-zinc-600">
            Admins (soon)
          </span>
          <span className="rounded-lg px-3 py-2 text-sm text-zinc-600">
            Audit log (soon)
          </span>
        </nav>

        <div className="border-t border-zinc-800 p-3">
          <LogoutButton />
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6">
          <div className="flex items-center gap-3 md:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-base font-black text-zinc-950">
              K
            </div>
            <span className="text-sm font-semibold">Konneqta Admin</span>
          </div>
          <div className="hidden md:block" />

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">
                {session.email}
              </p>
              <p className="text-xs leading-tight text-zinc-400">
                {session.admin?.role.display_name ?? "Admin"}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold uppercase">
              {session.email.charAt(0)}
            </div>
            <div className="md:hidden">
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}