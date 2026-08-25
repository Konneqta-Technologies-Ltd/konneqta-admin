import { AdminNav } from "./admin-nav";
import { LogoutButton } from "./logout-button";
import { hasPermission, requireAdmin } from "@/lib/auth/guard";

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
  const isSuperAdmin = session.admin?.role.name === "super_admin";
  const canGrantPro = await hasPermission(session, "users.grant_pro");

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-zinc-800 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, next/image adds no value */}
          <img
            src="/konneqta-logo.png"
            alt="Konneqta logo"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">
            Konneqta Admin
          </span>
        </div>

        <AdminNav isSuperAdmin={isSuperAdmin} canGrantPro={canGrantPro} />

        <div className="border-t border-zinc-800 p-3">
          <LogoutButton />
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6">
          <div className="flex items-center gap-3 md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, next/image adds no value */}
            <img
              src="/konneqta-logo.png"
              alt="Konneqta logo"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
            />
          </div>
          <div className="hidden md:block" />

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="hidden text-sm font-medium leading-tight md:block">
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

        <AdminNav
          isSuperAdmin={isSuperAdmin}
          canGrantPro={canGrantPro}
          mobile
        />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}