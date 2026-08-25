import { AdminAccountControls, InviteAdminForm } from "./admin-controls";
import { getAdminAccounts, getAdminRoles } from "@/lib/admin/data";
import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import { formatDate } from "../format";

export default async function AdminAccountsPage() {
  const session = await requireAdmin();
  const canRead = await hasPermission(session, "admins.read");
  if (!canRead) return <AccessDenied />;

  const [accounts, roles, canCreate, canUpdate] = await Promise.all([
    getAdminAccounts(),
    getAdminRoles(),
    hasPermission(session, "admins.create"),
    hasPermission(session, "admins.update"),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Security</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Administrators</h1>
        <p className="mt-1 text-sm text-zinc-400">Invite administrators and manage role-based access.</p>
      </div>

      {canCreate && <div className="mt-6"><InviteAdminForm roles={roles} /></div>}

      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-4 text-sm text-zinc-400">{accounts.length} admin accounts</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500"><tr><th className="px-5 py-3 font-medium">Administrator</th><th className="px-5 py-3 font-medium">Created</th><th className="px-5 py-3 font-medium">Current access</th><th className="px-5 py-3 font-medium" /></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-zinc-800/40">
                  <td className="px-5 py-4"><p className="font-medium text-white">{account.email}</p><p className="mt-1 font-mono text-xs text-zinc-600">{account.userId}</p></td>
                  <td className="px-5 py-4 text-zinc-400">{formatDate(account.createdAt)}</td>
                  <td className="px-5 py-4"><p className="text-zinc-200">{account.role.display_name}</p><p className="mt-1 text-xs capitalize text-zinc-500">{account.status}</p></td>
                  <td className="px-5 py-4 text-right">{canUpdate && <AdminAccountControls adminId={account.id} currentRoleId={account.role.id} currentStatus={account.status} roles={roles} isCurrentAdmin={account.id === session.admin!.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccessDenied() {
  return <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">You do not have permission to manage administrators.</div>;
}