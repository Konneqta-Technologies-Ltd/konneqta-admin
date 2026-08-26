"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useState } from "react";

/**
 * Enable / Disable toggle for one promo code row. Disabling is instant and
 * never touches days users already redeemed.
 */
export function PromoActions({
  id,
  code,
  active,
}: {
  id: string;
  code: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !active;
    const verb = next ? "enable" : "disable";
    if (
      !window.confirm(
        `${next ? "Enable" : "Disable"} ${code}?\n\n${
          next
            ? "Users will be able to redeem it again (within its window and use limit)."
            : "New redemptions stop immediately. Days already redeemed are kept."
        }`
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/promos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success(`${code} ${next ? "enabled" : "disabled"}.`);
        router.refresh();
      } else {
        toast.error(data.error || `Couldn't ${verb} ${code}.`);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-red-950/60 text-red-300 hover:bg-red-950"
          : "bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950"
      }`}
    >
      {busy ? "…" : active ? "Disable" : "Enable"}
    </button>
  );
}
