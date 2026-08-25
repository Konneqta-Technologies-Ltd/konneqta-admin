"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetupAdminPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) return setError(updateError.message);
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">First sign-in</p>
      <h1 className="mt-2 text-2xl font-bold">Set your admin password</h1>
      <p className="mt-2 text-sm text-zinc-400">Choose the password you will use for future administrator sign-ins.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        {error && <p className="rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
        <label className="block text-sm text-zinc-300">Password<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none focus:border-zinc-400" /></label>
        <label className="block text-sm text-zinc-300">Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none focus:border-zinc-400" /></label>
        <button disabled={loading} className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50">{loading ? "Saving…" : "Save password"}</button>
      </form>
    </div>
  );
}