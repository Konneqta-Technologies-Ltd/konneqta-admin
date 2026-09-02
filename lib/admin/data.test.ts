import { describe, expect, it } from "vitest";
import {
  sanitizeSearchTerm,
  buildCustomerSearchFilter,
  buildCustomerUserFilters,
  CUSTOMERS_PER_PAGE,
} from "@/lib/admin/data";

describe("sanitizeSearchTerm", () => {
  it("strips PostgREST/SQL metacharacters from user input", () => {
    expect(sanitizeSearchTerm('a%b,c(d)e"f\\g')).toBe("abcdefg");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSearchTerm("  ada  ")).toBe("ada");
  });

  it("passes ordinary search terms through unchanged", () => {
    expect(sanitizeSearchTerm("ada_lose")).toBe("ada_lose");
  });

  it("handles null/undefined input", () => {
    expect(sanitizeSearchTerm(null)).toBe("");
    expect(sanitizeSearchTerm(undefined)).toBe("");
  });
});

describe("buildCustomerSearchFilter", () => {
  it("returns null for empty or metacharacter-only terms", () => {
    expect(buildCustomerSearchFilter("")).toBeNull();
    expect(buildCustomerSearchFilter("   ")).toBeNull();
    expect(buildCustomerSearchFilter("%,,()")).toBeNull();
  });

  it("searches email, username, and full name columns", () => {
    const filter = buildCustomerSearchFilter("ada");
    expect(filter).toBe(
      "email.ilike.%ada%,username.ilike.%ada%,full_name.ilike.%ada%"
    );
  });

  it("adds an exact id match when the term is a valid UUID", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const filter = buildCustomerSearchFilter(uuid);
    expect(filter).toContain(`id.eq.${uuid}`);
    expect(filter).toContain(`email.ilike.%${uuid}%`);
  });

  it("does not add id.eq for non-UUID terms", () => {
    expect(buildCustomerSearchFilter("not-a-uuid")).not.toContain("id.eq");
  });
});

describe("pagination defaults", () => {
  it("keeps the page size within sane bounds", () => {
    expect(CUSTOMERS_PER_PAGE).toBeGreaterThan(0);
    expect(CUSTOMERS_PER_PAGE).toBeLessThanOrEqual(100);
  });
});

describe("buildCustomerUserFilters", () => {
  it("accepts every allow-listed plan value", () => {
    for (const plan of ["pro", "free", "exempt"] as const) {
      expect(buildCustomerUserFilters(plan, null)).toEqual({
        plan,
        status: null,
      });
    }
  });

  it("accepts every allow-listed status value", () => {
    for (const status of [
      "active",
      "deactivated",
      "suspended",
    ] as const) {
      expect(buildCustomerUserFilters(null, status)).toEqual({
        plan: null,
        status,
      });
    }
  });

  it("returns no filters for empty, all, or undefined values", () => {
    expect(buildCustomerUserFilters()).toEqual({ plan: null, status: null });
    expect(buildCustomerUserFilters("", "")).toEqual({
      plan: null,
      status: null,
    });
    expect(buildCustomerUserFilters("all", "all")).toEqual({
      plan: null,
      status: null,
    });
  });

  it("ignores unrecognised values so URLs cannot widen the query", () => {
    expect(buildCustomerUserFilters("bogus", "hacked")).toEqual({
      plan: null,
      status: null,
    });
  });
});
