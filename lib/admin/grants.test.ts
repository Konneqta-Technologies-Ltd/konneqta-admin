import { describe, expect, it, vi, afterEach } from "vitest";
import { grantState, proState, GRANT_MAX_DAYS } from "@/lib/admin/grants";

describe("grantState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Revoked when revoked_at is set, even if not expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(
      grantState({
        expires_at: "2027-01-01T00:00:00Z",
        revoked_at: "2026-08-01T00:00:00Z",
      })
    ).toBe("Revoked");
  });

  it("returns Expired when expiry has passed and not revoked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(grantState({ expires_at: "2026-08-25T11:59:59Z", revoked_at: null })).toBe(
      "Expired"
    );
  });

  it("treats expiry exactly at now as Expired (<= boundary)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(grantState({ expires_at: "2026-08-25T12:00:00Z", revoked_at: null })).toBe(
      "Expired"
    );
  });

  it("returns Active for a future expiry without revocation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(grantState({ expires_at: "2026-08-25T12:00:01Z", revoked_at: null })).toBe(
      "Active"
    );
  });
});

describe("proState", () => {
  it("exempt users are always Pro with no expiry", () => {
    expect(proState({ plan: "free", is_exempt: true })).toEqual({
      isPro: true,
      daysLeft: null,
    });
  });

  it("free plan without expiry is not Pro", () => {
    expect(proState({ plan: "free", is_exempt: false })).toEqual({
      isPro: false,
      daysLeft: null,
    });
  });

  it("pro plan with no expiry timestamp is not Pro (lazy expiry)", () => {
    expect(proState({ plan: "pro", is_exempt: false, pro_expires_at: null })).toEqual({
      isPro: false,
      daysLeft: null,
    });
  });

  it("expired pro window reports 0 days left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    expect(
      proState({ plan: "pro", is_exempt: false, pro_expires_at: "2026-08-25T08:00:00Z" })
    ).toEqual({ isPro: false, daysLeft: 0 });
    vi.useRealTimers();
  });

  it("rounds remaining time up to whole days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    // 6 hours left → 1 day (ceil)
    expect(
      proState({ plan: "pro", is_exempt: false, pro_expires_at: "2026-08-25T18:00:00Z" })
    ).toEqual({ isPro: true, daysLeft: 1 });
    // 30 days + 1 second → 31 days
    expect(
      proState({
        plan: "pro",
        is_exempt: false,
        pro_expires_at: "2026-09-24T12:00:01Z",
      })
    ).toEqual({ isPro: true, daysLeft: 31 });
    vi.useRealTimers();
  });
});

describe("GRANT_MAX_DAYS", () => {
  it("allows up to 10 years of complimentary access", () => {
    expect(GRANT_MAX_DAYS).toBe(3650);
  });
});
