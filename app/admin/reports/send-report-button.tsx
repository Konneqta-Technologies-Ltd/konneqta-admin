"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * "Send now" — emails the month's digest immediately (SUPER ADMIN only; the
 * route enforces it). Deliberate re-send: clears the period's idempotency
 * row first, unlike the cron path.
 */
export function SendReportButton({ month }: { month: string }) {
  const [sending, setSending] = useState(false);

  function confirmSend() {
    toast(`Email the ${month} report now? If it was already sent, this re-sends it.`, {
      duration: 10000,
      action: { label: "Send", onClick: () => void doSend() },
    });
  }

  async function doSend() {
    setSending(true);
    try {
      const response = await fetch("/api/admin/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Send failed.");
      toast.success(`Report emailed to ${result.recipient}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={confirmSend}
      disabled={sending}
      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {sending ? "Sending…" : "Send now (email)"}
    </button>
  );
}