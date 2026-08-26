"use client";

import { PROMO_CODE_PATTERN } from "@/lib/admin/promos";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useState } from "react";

/**
 * Create-promo form (client half of /admin/promos).
 *
 * Fields: code (auto-uppercased), reward days, optional max uses (empty =
 * unlimited), optional expiry datetime (empty = never), optional description.
 * POST /api/admin/promos → toast + router.refresh() so the table updates.
 */
export function PromoForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [rewardDays, setRewardDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalized = code.trim().toUpperCase();
    if (!PROMO_CODE_PATTERN.test(normalized)) {
      toast.error(
        "Code must be 3–30 characters: letters, numbers or underscores."
      );
      return;
    }
    const days = Number(rewardDays);
    if (!Number.isInteger(days) || days < 1) {
      toast.error("Days must be a whole number of at least 1.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalized,
          rewardDays: days,
          maxUses: maxUses.trim() === "" ? null : Number(maxUses),
          validUntil: validUntil ? new Date(validUntil).toISOString() : null,
          description: description.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (res.ok) {
        toast.success(`Promo code ${normalized} created.`);
        setCode("");
        setRewardDays("");
        setMaxUses("");
        setValidUntil("");
        setDescription("");
        router.refresh();
      } else {
        toast.error(data.error || "Couldn't create the promo code.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
      <div>
        <label
          htmlFor="promo-code"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Code (e.g. WELCOME30)
        </label>
        <input
          id="promo-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WELCOME30"
          maxLength={30}
          autoComplete="off"
          className={`${inputClass} font-mono tracking-wider`}
          required
        />
      </div>

      <div>
        <label
          htmlFor="promo-days"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Premium days per redemption
        </label>
        <input
          id="promo-days"
          type="number"
          min={1}
          max={3650}
          value={rewardDays}
          onChange={(e) => setRewardDays(e.target.value)}
          placeholder="30"
          className={inputClass}
          required
        />
      </div>

      <div>
        <label
          htmlFor="promo-max-uses"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Max uses (empty = unlimited)
        </label>
        <input
          id="promo-max-uses"
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="500"
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="promo-valid-until"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Expires (empty = never)
        </label>
        <input
          id="promo-valid-until"
          type="datetime-local"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="md:col-span-2">
        <label
          htmlFor="promo-description"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Description (optional)
        </label>
        <input
          id="promo-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Launch campaign"
          maxLength={200}
          className={inputClass}
        />
      </div>

      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={submitting}
          className="cursor-pointer rounded-lg bg-[#FF6B2C] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create promo code"}
        </button>
      </div>
    </form>
  );
}
