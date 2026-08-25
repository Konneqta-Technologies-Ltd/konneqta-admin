import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import { formatDate } from "../format";
import { getAuditLogs } from "@/lib/admin/data";

export default async function AdminAuditPage() {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "audit.read"))) return <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">You do not have permission to view audit logs.</div>;
  const logs = await getAuditLogs();

  return (
    <div className="mx-auto max-w-7xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Security</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-zinc-400">The 100 most recent sensitive administrator actions.</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500"><tr><th className="px-5 py-3 font-medium">When</th><th className="px-5 py-3 font-medium">Administrator</th><th className="px-5 py-3 font-medium">Action</th><th className="px-5 py-3 font-medium">Target</th><th className="px-5 py-3 font-medium">Details</th></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {logs.map((log) => <tr key={log.id} className="align-top hover:bg-zinc-800/40"><td className="whitespace-nowrap px-5 py-4 text-zinc-400">{formatDate(log.createdAt)}</td><td className="px-5 py-4 text-zinc-200">{log.adminEmail}</td><td className="px-5 py-4 font-mono text-xs text-white">{log.action}</td><td className="px-5 py-4"><p className="text-zinc-300">{log.targetType ?? "—"}</p><p className="mt-1 max-w-52 truncate font-mono text-xs text-zinc-600" title={log.targetId ?? ""}>{log.targetId ?? "—"}</p></td><td className="px-5 py-4"><code className="block max-w-sm whitespace-pre-wrap break-all text-xs text-zinc-500">{JSON.stringify(log.metadata)}</code></td></tr>)}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && <p className="px-5 py-10 text-center text-sm text-zinc-500">No audit events have been recorded.</p>}
      </div>
    </div>
  );
}