"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Broadcast composer — title/body/link + audience, with a live recipient
 * count (dry-run) before an irreversible send. Pure UX: validation and
 * enforcement live in the API route + lib/admin/broadcast.
 */
export function BroadcastForm({
  audiences,
  webPushConfigured,
}: {
  audiences: Array<{ value: string; label: string }>;
  webPushConfigured: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [audience, setAudience] = useState(audiences[0]?.value ?? "all");
  const [count, setCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  async function checkRecipients() {
    setChecking(true);
    try {
      const response = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, dryRun: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Count failed.");
      setCount(result.count);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Count failed.");
    } finally {
      setChecking(false);
    }
  }

  /** Confirmation via a sonner action toast — same pattern as revoke-pro. */
  function confirmSend() {
    toast(
      `Send this broadcast to ${count ?? "?"} recipient(s)? This cannot be undone.`,
      {
        duration: 10000,
        action: { label: "Send", onClick: () => void doSend() },
      }
    );
  }

  async function doSend() {
    setSending(true);
    try {
      const response = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          title,
          body,
          link: link.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Broadcast failed.");
      const parts = [
        `${result.recipients} user(s) reached`,
        `${result.inAppInserted} in-app`,
        `${result.pushSent} device push(es)`,
      ];
      if (result.optedOut > 0)
        parts.push(`${result.optedOut} opted out (skipped)`);
      if (result.pushTruncated)
        parts.push("device pushes partially delivered (time limit)");
      toast.success(`Broadcast sent — ${parts.join(", ")}.`);
      setTitle("");
      setBody("");
      setLink("");
      setCount(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Broadcast failed.");
    } finally {
      setSending(false);
    }
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-zinc-500">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="e.g. New: share your card as a QR"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-zinc-500">Audience</span>
          <select
            value={audience}
            onChange={(event) => {
              setAudience(event.target.value);
              setCount(null);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          >
            {audiences.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Message</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Keep it short — this appears verbatim in the notification center and on the lock screen."
          className="mt-1 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <span className="mt-1 block text-right text-xs text-zinc-600">{body.length}/500</span>
      </label>

      <label className="block">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Deep link (optional, app-relative)
        </span>
        <input
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="/referral"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <span className="mt-1 block text-xs text-zinc-600">
          Must start with a single “/” — both apps open it (web: site URL, mobile: konneqta://).
        </span>
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={checkRecipients}
          disabled={checking}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? "Counting…" : "Check recipients"}
        </button>
        <button
          type="button"
          onClick={confirmSend}
          disabled={!canSend || sending || count === null || count === 0}
          title={count === null ? "Check recipients first" : undefined}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send broadcast"}
        </button>
        {count !== null && (
          <span className="text-sm text-zinc-400">
            {count} recipient{count === 1 ? "" : "s"} (before opt-outs)
          </span>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        Delivery: in-app notification center (always) + Web Push (browsers/PWA)
        + Expo Push (iOS/Android). Users who turned off admin broadcasts in
        their app Settings are skipped. Every send is audit-logged.
        {!webPushConfigured && (
          <span className="text-amber-400">
            {" "}
            Web Push is not configured (missing VAPID keys) — browsers/PWA will
            not receive pushes; in-app + mobile still work.
          </span>
        )}
      </p>
    </div>
  );
}