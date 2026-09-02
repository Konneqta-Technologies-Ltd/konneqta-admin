import { describe, expect, it } from "vitest";

import {
  normalizePromoCodeFilter,
  PROMO_CODE_PATTERN,
  promoState,
  PROMO_STATUSES,
} from "./promos";

/**
 * Unit tests for the pure promo helpers (no DB — mirrors grants.test.ts).
 * The RPC in konneqta/supabase/promo-codes-setup.sql owns the real rules;
 * these only pin the admin-side state labels + code shape.
 */

const NOW = new Date("2026-03-15T12:00:00Z");

function promo(overrides: Partial<Parameters<typeof promoState>[0]> = {}) {
  return {
    active: true,
    valid_from: "2026-03-01T00:00:00Z",
    valid_until: "2026-04-01T00:00:00Z",
    max_uses: 100,
    uses: 0,
    ...overrides,
  };
}

describe("promoState", () => {
  it("labels an in-window, under-limit, enabled code Active", () => {
    expect(promoState(promo(), NOW)).toBe("Active");
  });

  it("labels a future valid_from Scheduled", () => {
    expect(
      promoState(promo({ valid_from: "2026-03-20T00:00:00Z" }), NOW)
    ).toBe("Scheduled");
  });

  it("labels a past valid_until Expired (auto-disable after the set date)", () => {
    expect(
      promoState(promo({ valid_until: "2026-03-10T00:00:00Z" }), NOW)
    ).toBe("Expired");
  });

  it("treats NULL valid_until as never expiring", () => {
    expect(promoState(promo({ valid_until: null }), NOW)).toBe("Active");
  });

  it("labels a code at its use cap Fully redeemed", () => {
    expect(promoState(promo({ uses: 100, max_uses: 100 }), NOW)).toBe(
      "Fully redeemed"
    );
  });

  it("labels unlimited codes Fully redeemed never (no cap)", () => {
    expect(promoState(promo({ uses: 10_000, max_uses: null }), NOW)).toBe(
      "Active"
    );
  });

  it("labels a toggled-off code Disabled even mid-window", () => {
    expect(promoState(promo({ active: false }), NOW)).toBe("Disabled");
  });

  it("Disabled wins over Expired (manual state is always visible)", () => {
    expect(
      promoState(
        promo({ active: false, valid_until: "2026-03-10T00:00:00Z" }),
        NOW
      )
    ).toBe("Disabled");
  });
});

describe("PROMO_CODE_PATTERN", () => {
  it.each(["WELCOME30", "KONNEQTA_2026", "ABC", "A_1_B_2_C_3_D_4_E_5"])(
    "accepts %s",
    (code) => {
      expect(PROMO_CODE_PATTERN.test(code)).toBe(true);
    }
  );

  it.each([
    "NO", // too short
    "HAS SPACE",
    "BAD-DASH",
    "BAD.DOT",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ01234", // 31 chars — too long
    "",
  ])("rejects %s", (code) => {
    expect(PROMO_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("normalizePromoCodeFilter", () => {
  it("uppercases and accepts a valid code", () => {
    expect(normalizePromoCodeFilter(" welcome30 \n")).toBe("WELCOME30");
  });

  it("rejects codes that violate the stored pattern", () => {
    expect(normalizePromoCodeFilter("NO")).toBeNull();
    expect(normalizePromoCodeFilter("DROP TABLE;--")).toBeNull();
    expect(normalizePromoCodeFilter("has space")).toBeNull();
  });

  it("treats empty or missing input as no filter", () => {
    expect(normalizePromoCodeFilter(null)).toBeNull();
    expect(normalizePromoCodeFilter("")).toBeNull();
    expect(normalizePromoCodeFilter("   ")).toBeNull();
  });
});

describe("PROMO_STATUSES", () => {
  it("covers every PromoState label exactly once", () => {
    expect(new Set(PROMO_STATUSES).size).toBe(PROMO_STATUSES.length);
    expect(PROMO_STATUSES).toContain("Active");
    expect(PROMO_STATUSES).toContain("Disabled");
  });
});
