import { describe, expect, it } from "vitest";
import { formatDate, formatCurrency, formatRelativeTime } from "@/app/admin/format";

describe("formatDate", () => {
  it("renders an em dash for null/undefined/empty values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("formats an ISO timestamp with date and time", () => {
    const result = formatDate("2026-08-25T14:30:00Z");
    expect(result).not.toBe("—");
    expect(result).toMatch(/2026/);
  });
});

describe("formatCurrency", () => {
  it("formats whole naira without fraction digits", () => {
    const result = formatCurrency(1_500_000);
    expect(result).toContain("1,500,000");
    expect(result).not.toContain(".");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toMatch(/0/);
  });
});

describe("formatRelativeTime", () => {
  const NOW = Date.parse("2026-10-30T12:00:00Z");

  it("renders an em dash for null/undefined/empty values", () => {
    expect(formatRelativeTime(null, NOW)).toBe("—");
    expect(formatRelativeTime(undefined, NOW)).toBe("—");
    expect(formatRelativeTime("", NOW)).toBe("—");
  });

  it("renders an em dash for unparseable input instead of throwing", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("—");
  });

  it.each([
    ["2026-10-30T11:59:59Z", "just now"],
    ["2026-10-30T11:59:00Z", "1m ago"],
    ["2026-10-30T11:45:00Z", "15m ago"],
    ["2026-10-30T09:30:00Z", "2h ago"],
    ["2026-10-28T12:00:00Z", "2d ago"],
  ])("renders %s as %s", (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });

  it("never renders a future time as negative", () => {
    expect(formatRelativeTime("2026-10-30T12:00:30Z", NOW)).toBe("just now");
  });
});
