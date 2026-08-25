"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { AdminRole } from "@/lib/admin/data";

type AdminStatus = "active" | "suspended" | "revoked";

export function InviteAdminForm({ roles }: { roles: AdminRole[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(
    roles.find((role) => role.name === "admin")?.id ?? roles[0]?.id ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleId }),
      });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Unable to invite admin.");
      setEmail("");
      setMessage(result.message ?? "Admin invitation sent.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to invite admin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="font-semibold">Invite an administrator</h2>
      <p className="mt-1 text-sm text-zinc-500">
        New accounts receive a Supabase invitation email. Existing users are granted access immediately.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@konneqta.com"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
        />
        <select
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          required
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>{role.display_name}</option>
          ))}
        </select>
        <button disabled={loading || !roleId} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50">
          {loading ? "Inviting…" : "Send invite"}
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-zinc-300">{message}</p>}
    </form>
  );
}

export function AdminAccountControls({
  adminId,
  currentRoleId,
  currentStatus,
  roles,
  isCurrentAdmin,
}: {
  adminId: string;
  currentRoleId: string;
  currentStatus: AdminStatus;
  roles: AdminRole[];
  isCurrentAdmin: boolean;
}) {
  const router = useRouter();
  const [roleId, setRoleId] = useState(currentRoleId);
  const [status, setStatus] = useState<AdminStatus>(currentStatus);
  const [loading, setLoading] = useState(false);

  async function save() {
    if (isCurrentAdmin && (roleId !== currentRoleId || status !== currentStatus)) {
      toast.error("You cannot change your own role or status.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/admins/${adminId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, status }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update admin.");
      toast.success("Admin updated.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update admin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-w-[350px] items-center justify-end gap-2">
      <select value={roleId} onChange={(event) => setRoleId(event.target.value)} disabled={isCurrentAdmin || loading} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white disabled:opacity-50">
        {roles.map((role) => <option key={role.id} value={role.id}>{role.display_name}</option>)}
      </select>
      <select value={status} onChange={(event) => setStatus(event.target.value as AdminStatus)} disabled={isCurrentAdmin || loading} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white disabled:opacity-50">
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="revoked">Revoked</option>
      </select>
      <button type="button" onClick={save} disabled={isCurrentAdmin || loading || (roleId === currentRoleId && status === currentStatus)} className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
        {loading ? "Saving…" : "Save"}
      </button>
    </div>
  );
}