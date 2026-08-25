"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type ProfileStatus = "active" | "deactivated" | "suspended";

export function UserStatusButton({
  id,
  status,
}: {
  id: string;
  status: ProfileStatus;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const nextStatus = status === "suspended" ? "active" : "suspended";

  /**
   * Confirmation via a sonner action toast (replaces window.confirm): the
   * PATCH only runs when the admin clicks the confirm label in the toast.
   */
  function requestStatusChange() {
    const action = nextStatus === "suspended" ? "suspend" : "unsuspend";
    toast(`${action[0].toUpperCase()}${action.slice(1)} this customer profile?`, {
      duration: 8000,
      action: {
        label: action[0].toUpperCase() + action.slice(1),
        onClick: () => {
          void updateStatus();
        },
      },
    });
  }

  async function updateStatus() {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update user.");
      }
      toast.success(
        nextStatus === "suspended" ? "Customer suspended." : "Customer unsuspended."
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update user."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={requestStatusChange}
      disabled={loading}
      className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading
        ? "Saving…"
        : status === "suspended"
          ? "Unsuspend"
          : "Suspend"}
    </button>
  );
}