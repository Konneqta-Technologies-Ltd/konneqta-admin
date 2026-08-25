import { hasPermission, requireAdmin } from "@/lib/auth/guard";

import Link from "next/link";
import { formatDate } from "../format";
import { getAuditLogs } from "@/lib/admin/data";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; admin?: string }>;
}) {
  const session = await requireAdmin();
  if (!(await hasPermission(session, "audit.read"))) return <AccessDenied />;

  const params = await searchParams;
  const action = params.action?.trim() ?? "";
  const admin = params.admin?.trim() ?? "";
  const logs = await getAuditLogs({ action, admin });
  const hasFilters = Boolean(action || admin);

  return (
    <div className="mx-auto max-w-7xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Security
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-zinc-400">
        The {logs.length === 100 ? "100 most recent" : `${logs.length}`}{" "}
        sensitive administrator actions
        {hasFilters ? " matching the filters below." : "."}
      </p>

      <form
        action="/admin/audit"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <input
          name="action"
          defaultValue={action}
          placeholder="Action contains… (e.g. user.suspend)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 sm:w-64"
        />
        <input
          name="admin"
          defaultValue={admin}
          placeholder="Administrator email contains…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 sm:w-64"
        />
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/audit"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Administrator</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Target</th>
                <th className="px-5 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {logs.map((log) => (
                <tr key={log.id} className="align-top hover:bg-zinc-800/40">
                  <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-zinc-200">{log.adminEmail}</td>
                  <td className="px-5 py-4 font-mono text-xs text-white">
                    {log.action}
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-zinc-300">{log.targetType ?? "—"}</p>
                    <p
                      className="mt-1 max-w-52 truncate font-mono text-xs text-zinc-600"
                      title={log.targetId ?? ""}
                    >
                      {log.targetId ?? "—"}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <code className="block max-w-sm whitespace-pre-wrap break-all text-xs text-zinc-500">
                      {JSON.stringify(log.metadata)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            {hasFilters
              ? "No audit events match these filters."
              : "No audit events have been recorded."}
          </p>
        )}
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-200">
      You do not have permission to view audit logs.
    </div>
  );
}
