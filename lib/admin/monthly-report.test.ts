import { describe, expect, it } from "vitest";

import {
  formatNaira,
  formatReportEmailHtml,
  formatReportText,
  growthPct,
  monthLabel,
  parseMonthParam,
  pctLabel,
  previousMonthRange,
  type MonthlyReport,
} from "./monthly-report";

/**
 * Unit tests for the pure monthly-report helpers (no DB — mirrors the other
 * lib tests). The SQL RPC owns the numbers; these pin the month math, growth
 * %, formatting and email rendering.
 */

const NOV_2_2026 = new Date("2026-11-02T10:00:00Z");

function report(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    from: "2026-10-01",
    to: "2026-11-01",
    label: "October 2026",
    users: {
      new: 120,
      prevNew: 100,
      newGrowthPct: 20,
      total: 5000,
      suspended: 3,
      deactivated: 7,
    },
    revenue: {
      count: 40,
      total: 1_250_000,
      prevTotal: 1_000_000,
      totalGrowthPct: 25,
      failed: 2,
      premiumCount: 30,
      teamsCount: 10,
      avgPerPayment: 31_250,
    },
    pro: {
      activeEnd: 310,
      newConversions: 28,
      expired: 12,
      grants: 5,
      grantsDays: 150,
    },
    referrals: {
      attached: 60,
      converted: 14,
      top: [
        {
          username: "<b>ada</b>",
          code: "ADAK2QP9",
          signups: 12,
          rewards: 5,
          daysAwarded: 50,
        },
      ],
    },
    promos: {
      redemptions: 25,
      top: [{ code: "WELCOME30", redemptions: 18, daysGranted: 540 }],
    },
    engagement: { cardsCreated: 90, profileViews: 12_000, konneqts: 3_400 },
    adminActions: 17,
    ...overrides,
  };
}

describe("previousMonthRange", () => {
  it("returns the previous calendar month (UTC, end-exclusive)", () => {
    expect(previousMonthRange(NOV_2_2026)).toEqual({
      from: "2026-10-01",
      to: "2026-11-01",
      label: "October 2026",
    });
  });

  it("wraps across the year boundary in January", () => {
    const jan = new Date("2026-01-05T00:00:00Z");
    expect(previousMonthRange(jan)).toEqual({
      from: "2025-12-01",
      to: "2026-01-01",
      label: "December 2025",
    });
  });

  it("is stable mid-month (always the previous month)", () => {
    expect(previousMonthRange(new Date("2026-03-15T23:59:59Z")).from).toBe(
      "2026-02-01"
    );
  });
});

describe("parseMonthParam", () => {
  it("parses a valid YYYY-MM facet", () => {
    expect(parseMonthParam("2025-10", NOV_2_2026)).toEqual({
      from: "2025-10-01",
      to: "2025-11-01",
      label: "October 2025",
    });
  });

  it.each(["bogus", "2026-13", "2025-00", "10-2025", "2025/10", ""])(
    "nulls garbage %s so the caller falls back to the previous month",
    (value) => {
      expect(parseMonthParam(value, NOV_2_2026)).toBeNull();
    }
  );

  it("nulls the current and future months (no report exists yet)", () => {
    expect(parseMonthParam("2026-11", NOV_2_2026)).toBeNull();
    expect(parseMonthParam("2027-01", NOV_2_2026)).toBeNull();
  });

  it("accepts the previous month", () => {
    expect(parseMonthParam("2026-10", NOV_2_2026)?.from).toBe("2026-10-01");
  });
});

describe("growthPct / pctLabel", () => {
  it("computes month-over-month growth with 1 decimal", () => {
    expect(growthPct(120, 100)).toBe(20);
    expect(growthPct(90, 100)).toBe(-10);
    expect(growthPct(1250, 1000)).toBe(25);
    expect(growthPct(1, 3)).toBe(-66.7);
  });

  it("returns null when there is no previous baseline", () => {
    expect(growthPct(50, 0)).toBeNull();
    expect(growthPct(0, 0)).toBeNull();
  });

  it("renders percent labels", () => {
    expect(pctLabel(20)).toBe("+20%");
    expect(pctLabel(-3)).toBe("-3%");
    expect(pctLabel(0)).toBe("0%"); // flat growth: neutral, no sign
    expect(pctLabel(null)).toBe("—");
  });
});

describe("formatting", () => {
  it("monthLabel renders the UTC month name", () => {
    expect(monthLabel("2026-10-01")).toBe("October 2026");
    expect(monthLabel("2025-12-01")).toBe("December 2025");
  });

  it("formatNaira renders whole naira", () => {
    expect(formatNaira(1_250_000)).toBe("₦1,250,000");
  });
});

describe("formatReportEmailHtml", () => {
  it("escapes user-derived strings (top-referrer usernames)", () => {
    const html = formatReportEmailHtml(report());
    expect(html).toContain("&lt;b&gt;ada&lt;/b&gt;");
    expect(html).not.toContain("<b>ada</b>");
  });

  it("renders every section with the headline numbers", () => {
    const html = formatReportEmailHtml(report());
    expect(html).toContain("Konneqta — October 2026 report");
    expect(html).toContain("120 (+20% vs previous month)");
    expect(html).toContain("₦1,250,000");
    expect(html).toContain("310");
    expect(html).toContain("ADAK2QP9");
    expect(html).toContain("WELCOME30");
  });

  it("shows placeholders when there is no referral/promo activity", () => {
    const html = formatReportEmailHtml(
      report({ referrals: { attached: 0, converted: 0, top: [] }, promos: { redemptions: 0, top: [] } })
    );
    expect(html).toContain("No referral activity this month.");
    expect(html).toContain("No promo redemptions this month.");
  });
});

describe("formatReportText", () => {
  it("renders the numbered plain-text digest", () => {
    const text = formatReportText(report());
    expect(text).toContain("Konneqta — October 2026 report");
    expect(text).toContain("1. Signups: 120 new (+20% MoM), 5000 total");
    expect(text).toContain("2. Revenue: ₦1,250,000 from 40 payments (+25% MoM)");
    expect(text).toContain("3. Pro: 310 active at end");
    expect(text).toContain("4. Referrals: 60 attached, 14 converted");
    expect(text).toContain("- <b>ada</b> (ADAK2QP9): 12 signups, 5 conversions, +50d");
    expect(text).toContain("7. Admin actions: 17");
  });
});