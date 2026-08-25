"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const DURATION_CHIPS = [7, 14, 30, 60, 90] as const;

/**
 * "Pro access" management panel on the customer detail page.
 *
 * Grant: duration chips + custom days + optional note → POST grant-pro.
 * Revoke: immediate downgrade → POST revoke-pro (guarded server-side against
 * active paid subscriptions). All enforcement lives in the API route +
 * lib/admin/grants; this component is pure UX.
 */
export function GrantProPanel({
  userId,
  isExempt,
  isPro,
  daysLeft,
}: {
  userId: string;
  isExempt: boolean;
  isPro: boolean;
  /** Whole days remaining on the current Pro window (null = no expiry set). */
  daysLeft: number | null;
}) {
  const router = useRouter();
  const [days, setDays] = useState<number>(30);
  const [customMode, setCustomMode] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState<"grant" | "revoke" | null>(null);

  const effectiveDays = customMode ? parseInt(customDays, 10) : days;

  async function grant() {
    if (!Number.isInteger(effectiveDays) || effectiveDays < 1 || effectiveDays > 3650) {
      toast.error("Days must be a whole number between 1 and 3650.");
      return;
    }
    setLoading("grant");
    try {
      const response = await fetch(`/api/admin/users/${userId}/grant-pro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: effectiveDays, note: note.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Grant failed.");
      toast.success(
        result.extended
          ? `Extended Pro by ${result.days} days (now expires ${new Date(result.expiresAt).toUTCString()}).`
          : `Granted ${result.days} days of Pro (expires ${new Date(result.expiresAt).toUTCString()}).`
      );
      setNote("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Grant failed.");
    } finally {
      setLoading(null);
    }
  }

  /**
   * Confirmation via a sonner action toast (replaces window.confirm): the
   * destructive call only runs when the admin clicks "Revoke" in the toast.
   */
  function confirmRevoke() {
    toast(
      "Revoke complimentary Pro from this user immediately? They lose all Pro features right away.",
      {
        duration: 10000,
        action: {
          label: "Revoke",
          onClick: () => {
            void doRevoke();
          },
        },
      }
    );
  }

  async function doRevoke() {
    setLoading("revoke");
    try {
      const response = await fetch(`/api/admin/users/${userId}/revoke-pro`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Revoke failed.");
      toast.success("Pro access revoked.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed.");
    } finally {
      setLoading(null);
    }
  }

  if (isExempt) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
        This user is <span className="font-medium text-white">exempt</span> —
        unlimited access, permanently. Nothing to grant or revoke.
      </div>
    );
  }


  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Pro access</h2>
          <p className="mt-1 text-xs text-zinc-400">
            {isPro
              ? daysLeft !== null
                ? `Active — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Granting extends the window.`
                : "Active."
              : "Currently on the free plan."}
          </p>
        </div>
        {isPro && (
          <button
            type="button"
            onClick={confirmRevoke}
            disabled={loading !== null}
            className="rounded-md border border-red-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading === "revoke" ? "Revoking…" : "Revoke Pro"}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {DURATION_CHIPS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDays(d);
                setCustomMode(false);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                !customMode && days === d
                  ? "border-white bg-white text-zinc-950"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {d} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomMode(true)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              customMode
                ? "border-white bg-white text-zinc-950"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Custom
          </button>
          {customMode && (
            <input
              type="number"
              min={1}
              max={3650}
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
              placeholder="Days"
              autoFocus
              className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white outline-none focus:border-zinc-400"
            />
          )}
        </div>

        <input
          type="text"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional) — e.g. Giveaway winner"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />

        <button
          type="button"
          onClick={grant}
          disabled={loading !== null}
          className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === "grant"
            ? "Granting…"
            : isPro
              ? "Extend Pro"
              : "Grant Pro"}
        </button>
      </div>
    </div>
  );
}
