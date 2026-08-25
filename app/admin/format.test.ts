import { describe, expect, it } from "vitest";
import { formatDate, formatCurrency } from "@/app/admin/format";

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
