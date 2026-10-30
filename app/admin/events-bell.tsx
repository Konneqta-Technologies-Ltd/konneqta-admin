"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "./format";

/**
 * Admin bell — polls the platform event feed (GET /api/admin/events) every
 * 45s while the tab is visible and on tab focus, shows an unread badge, and
 * opens a dropdown of the latest events. Clicking an event navigates to its
 * admin page; "Mark all read" upserts the admin's seen marker (POST).
 * Best-effort by design: fetch failures just leave the previous state.
 */

type AdminEvent = {
  type: string;
  title: string;
  body: string;
  link: string;
  createdAt: string;
};

const DOT_COLOR: Record<string, string> = {
  signup: "bg-sky-400",
  payment: "bg-emerald-400",
  referral: "bg-fuchsia-400",
  grant: "bg-amber-400",
  promo: "bg-violet-400",
  broadcast: "bg-white",
  notify: "bg-zinc-400",
  suspend: "bg-red-400",
  report: "bg-emerald-300",
};

export function EventsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/events", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setEvents(data.events ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // Best-effort — keep whatever we last had.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so no setState runs synchronously inside the effect
    // (react-hooks/set-state-in-effect).
    const initial = setTimeout(() => void fetchEvents(), 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchEvents();
    }, 45_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchEvents]);

  async function markAllRead() {
    setMarking(true);
    try {
      await fetch("/api/admin/events", { method: "POST" });
      await fetchEvents();
    } finally {
      setMarking(false);
    }
  }

  function openEvent(link: string) {
    setOpen(false);
    if (link) router.push(link);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
      >
        {/* Bell icon (inline — the admin app has no icon package) */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-11 z-50 w-[380px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <button
                type="button"
                onClick={markAllRead}
                disabled={marking || unread === 0}
                className="text-xs font-medium text-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {marking ? "Marking…" : "Mark all read"}
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {loading ? (
                <p className="px-4 py-8 text-center text-sm text-zinc-500">
                  Loading…
                </p>
              ) : events.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-zinc-500">
                  No platform events in the last 7 days.
                </p>
              ) : (
                events.map((event, index) => {
                  const key = `${event.type}-${event.createdAt}-${index}`;
                  const isNew =
                    unread > 0 &&
                    index < unread; // feed is newest-first; unread are the leading rows
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => openEvent(event.link)}
                      className="flex w-full items-start gap-3 border-b border-zinc-800/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-zinc-800/60"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_COLOR[event.type] ?? "bg-zinc-500"} ${isNew ? "" : "opacity-30"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-white">
                            {event.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-500">
                            {formatRelativeTime(event.createdAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-400">
                          {event.body}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}