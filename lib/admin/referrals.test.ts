import { describe, expect, it } from "vitest";

import {
  isoNextDay,
  isoStartOfDay,
  normalizeDateRange,
  normalizeReferralCodeFilter,
  REFERRAL_CODE_PATTERN,
  REFERRAL_STATUSES,
} from "./referrals";

/**
 * Unit tests for the pure referral helpers (no DB — mirrors promos.test.ts).
 * The referral SYSTEM lives in the customer app; these only pin the admin
 * side's filter normalisation and date-range boundary math.
 */

describe("REFERRAL_CODE_PATTERN", () => {
  it.each(["VICTORK2QP9", "ADA12345", "ABCDEFGHIJKLMNOPQRSTUVWXY"])(
    "accepts %s",
    (code) => {
      expect(REFERRAL_CODE_PATTERN.test(code)).toBe(true);
    }
  );

  it.each([
    "ABCDE", // 5 chars — below the customer app's MIN_REFERRAL_CODE_LENGTH
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", // 26 chars — above the 25 cap
    "HAS SPACE",
    "BAD-DASH",
    "bad.lower",
    "",
  ])("rejects %s", (code) => {
    expect(REFERRAL_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("normalizeReferralCodeFilter", () => {
  it("uppercases and strips separators the way the customer app stores codes", () => {
    expect(normalizeReferralCodeFilter(" victor-k2qp9 ")).toBe("VICTORK2QP9");
    expect(normalizeReferralCodeFilter("ada 12345")).toBe("ADA12345");
  });

  it("normalised garbage that still matches the shape is a safe no-match filter", () => {
    // Parameterised .eq() — worst case is zero rows, never a broken query.
    expect(normalizeReferralCodeFilter("DROP TABLE;--")).toBe("DROPTABLE");
  });

  it("rejects codes outside the stored length bounds after normalising", () => {
    expect(normalizeReferralCodeFilter("abc")).toBeNull();
    expect(normalizeReferralCodeFilter("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toBeNull();
  });

  it("treats empty or missing input as no filter", () => {
    expect(normalizeReferralCodeFilter(null)).toBeNull();
    expect(normalizeReferralCodeFilter("")).toBeNull();
    expect(normalizeReferralCodeFilter("   ")).toBeNull();
    expect(normalizeReferralCodeFilter("---")).toBeNull();
  });
});

describe("normalizeDateRange", () => {
  it("passes through a valid inclusive calendar range", () => {
    expect(normalizeDateRange("2026-10-01", "2026-10-31")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("silently swaps a reversed range", () => {
    expect(normalizeDateRange("2026-10-31", "2026-10-01")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("allows one-sided ranges", () => {
    expect(normalizeDateRange("2026-10-01", null)).toEqual({
      from: "2026-10-01",
      to: null,
    });
    expect(normalizeDateRange(null, "2026-10-31")).toEqual({
      from: null,
      to: "2026-10-31",
    });
  });

  it.each([
    "bogus",
    "2026-1-1",
    "2026-13-01",
    "2026-02-30",
    "2027-02-29", // not a leap year
    "2026-10-01T00:00:00Z",
    "2026-10-01; DROP TABLE referrals",
  ])("nulls garbage input %s (no filter — cannot break the query)", (value) => {
    const range = normalizeDateRange(value, value);
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(normalizeDateRange("2028-02-29", "2028-03-01")).toEqual({
      from: "2028-02-29",
      to: "2028-03-01",
    });
  });
});

describe("date boundary helpers", () => {
  it("isoStartOfDay gives the inclusive UTC day start", () => {
    expect(isoStartOfDay("2026-10-01")).toBe("2026-10-01T00:00:00Z");
  });

  it("isoNextDay gives the EXCLUSIVE upper bound (end date fully included)", () => {
    expect(isoNextDay("2026-10-31")).toBe("2026-11-01T00:00:00.000Z");
    expect(isoNextDay("2026-12-31")).toBe("2027-01-01T00:00:00.000Z");
    expect(isoNextDay("2028-02-29")).toBe("2028-03-01T00:00:00.000Z");
  });
});

describe("REFERRAL_STATUSES", () => {
  it("covers every stored status exactly once", () => {
    expect(new Set(REFERRAL_STATUSES).size).toBe(REFERRAL_STATUSES.length);
    expect(REFERRAL_STATUSES).toContain("signed_up");
    expect(REFERRAL_STATUSES).toContain("rewarded");
    expect(REFERRAL_STATUSES).toContain("revoked");
  });
});