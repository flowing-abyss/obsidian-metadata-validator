import { describe, it, expect } from "vitest";
import { checkDateFormat } from "../date-format";

const PATH = "schemas/book/manifest.md";

describe("checkDateFormat", () => {
  // ── null / skip cases ────────────────────────────────────────────────────

  it("returns null for undefined value", () => {
    expect(checkDateFormat("date", undefined, "YYYY-MM-DD", PATH)).toBeNull();
  });

  it("returns null for null value", () => {
    expect(checkDateFormat("date", null, "YYYY-MM-DD", PATH)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(checkDateFormat("date", "", "YYYY-MM-DD", PATH)).toBeNull();
  });

  it("returns null for non-string/number types", () => {
    expect(checkDateFormat("date", { foo: 1 }, "YYYY-MM-DD", PATH)).toBeNull();
  });

  // ── with format: structural check ───────────────────────────────────────

  it("returns null when value matches YYYY-MM-DD format", () => {
    expect(checkDateFormat("date", "2024-03-15", "YYYY-MM-DD", PATH)).toBeNull();
  });

  it("returns error when value does not match YYYY-MM-DD format", () => {
    const r = checkDateFormat("date", "15-03-2024", "YYYY-MM-DD", PATH);
    expect(r?.rule).toBe("date-format");
    expect(r?.severity).toBe("error");
    expect(r?.message).toContain("YYYY-MM-DD");
  });

  it("returns null for DD/MM/YYYY format with matching value", () => {
    expect(checkDateFormat("date", "15/03/2024", "DD/MM/YYYY", PATH)).toBeNull();
  });

  it("returns error for DD/MM/YYYY format with wrong value", () => {
    const r = checkDateFormat("date", "2024/03/15", "DD/MM/YYYY", PATH);
    expect(r?.rule).toBe("date-format");
  });

  it("returns null for MM/DD/YYYY format", () => {
    expect(checkDateFormat("date", "03/15/2024", "MM/DD/YYYY", PATH)).toBeNull();
  });

  it("returns null for DD.MM.YYYY format", () => {
    expect(checkDateFormat("date", "15.03.2024", "DD.MM.YYYY", PATH)).toBeNull();
  });

  it("returns null for YY-MM-DD format", () => {
    expect(checkDateFormat("date", "24-03-15", "YY-MM-DD", PATH)).toBeNull();
  });

  // ── with format: calendar validation ────────────────────────────────────

  it("returns error for structurally valid but calendar-invalid date (month 13)", () => {
    const r = checkDateFormat("date", "2024-13-01", "YYYY-MM-DD", PATH);
    expect(r?.rule).toBe("date-format");
    expect(r?.message).toContain("not a valid calendar date");
  });

  it("returns error for day 32", () => {
    const r = checkDateFormat("date", "2024-03-32", "YYYY-MM-DD", PATH);
    expect(r?.rule).toBe("date-format");
    expect(r?.message).toContain("not a valid calendar date");
  });

  it("returns error for Feb 30", () => {
    const r = checkDateFormat("date", "2024-02-30", "YYYY-MM-DD", PATH);
    expect(r?.rule).toBe("date-format");
  });

  it("returns null for Feb 29 in a leap year", () => {
    expect(checkDateFormat("date", "2024-02-29", "YYYY-MM-DD", PATH)).toBeNull();
  });

  it("returns error for Feb 29 in a non-leap year", () => {
    const r = checkDateFormat("date", "2023-02-29", "YYYY-MM-DD", PATH);
    expect(r?.rule).toBe("date-format");
  });

  // ── without format: fallback Date.parse check ────────────────────────────

  it("returns null for a recognisable date string without format", () => {
    expect(checkDateFormat("date", "2024-03-15", undefined, PATH)).toBeNull();
  });

  it("returns warning for an unrecognisable string without format", () => {
    const r = checkDateFormat("date", "not-a-date", undefined, PATH);
    expect(r?.severity).toBe("warning");
    expect(r?.rule).toBe("date-format");
  });

  it("accepts numeric value as a date string", () => {
    // Numbers coerced to string — "20240315" parses as a large integer (not a date)
    const r = checkDateFormat("date", "20240315", "YYYY-MM-DD", PATH);
    // Structural check: 20240315 doesn't match YYYY-MM-DD
    expect(r?.rule).toBe("date-format");
  });

  // ── field metadata on the result ─────────────────────────────────────────

  it("includes field name and manifestPath in the result", () => {
    const r = checkDateFormat("published", "bad", "YYYY-MM-DD", PATH);
    expect(r?.field).toBe("published");
    expect(r?.manifestPath).toBe(PATH);
    expect(r?.autoFixed).toBe(false);
  });
});
