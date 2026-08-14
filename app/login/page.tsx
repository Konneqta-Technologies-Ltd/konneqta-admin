"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Admin login — email + password only.
 *
 * NO Google. NO signup. NO public registration.
 *
 * Flow:
 *   1. signInWithPassword() → Supabase Auth
 *   2. On success, check admin_users for this user (RLS allows reading only
 *      your own row). If not an active admin → sign out + access denied.
 *   3. If active admin → router.push("/admin").
 *
 * The proxy and requireAdmin() enforce the same checks server-side — the
 * client-side check here is just for fast, friendly feedback.
 */

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Create the client LAZILY (inside the handler, not at render time)
      // so prerendering this page during `next build` never touches the
      // Supabase env vars — the build succeeds even when secrets are not
      // configured in the CI environment. (Same pattern as logout-button.)
      const supabase = createClient();

      // 1. Authenticate against Supabase Auth.
      const { data, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError || !data.user) {
        setError("Invalid email or password.");
        return;
      }

      // 2. Authorization: does this user have an ACTIVE admin row?
      //    RLS restricts the read to the caller's own row.
      const { data: adminUser } = await supabase
        .from("admin_users")
        .select("id, status")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!adminUser || adminUser.status !== "active") {
        // Not an admin (or suspended/revoked) — destroy the session so a
        // normal Konneqta user can't linger with an admin-app session.
        await supabase.auth.signOut();
        setError("Access denied. This account is not an administrator.");
        return;
      }

      // 3. Active admin → dashboard.
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / wordmark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-2xl font-black text-zinc-950">
            K
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Konneqta Admin
          </h1>
          <p className="text-sm text-zinc-400">
            Sign in to access the dashboard
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
        >
          {error && (
            <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-zinc-200"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@konneqta.com"
            className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-white"
          />

          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-zinc-200"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mb-6 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-white"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-xs text-zinc-500">
            Forgot your password? Contact a Super Admin.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Authorized personnel only. Access is granted by invitation.
        </p>
      </div>
    </main>
  );
}