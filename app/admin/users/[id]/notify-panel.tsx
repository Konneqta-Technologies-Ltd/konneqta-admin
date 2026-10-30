"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * "Send notification" panel on the customer detail page — one user, both
 * device legs + in-app row (all handled server-side). Pure UX.
 */
export function NotifyPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);

  function confirmSend() {
    toast("Send this notification to this user?", {
      duration: 8000,
      action: { label: "Send", onClick: () => void doSend() },
    });
  }

  async function doSend() {
    setSending(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, link: link.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Send failed.");
      toast.success(
        `Delivered — in-app + ${result.pushSent} device push(es).`
      );
      setTitle("");
      setBody("");
      setLink("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-semibold text-white">Send notification</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Lands in this user&apos;s notification center and on every device they
        registered (browser + mobile app).
      </p>

      <div className="mt-4 space-y-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder="Title — e.g. Your Pro was extended"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Message (max 500 characters)"
          className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <input
          value={link}
          onChange={(event) => setLink(event.target.value)}
          maxLength={200}
          placeholder="Deep link (optional, app-relative) — e.g. /referral"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <button
          type="button"
          onClick={confirmSend}
          disabled={!canSend || sending}
          className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send notification"}
        </button>
      </div>
    </div>
  );
}