import { describe, it, expect } from "vitest";
import { applyAutoFix } from "../auto-fix";
import type { ManifestField } from "../../types";

describe("applyAutoFix", () => {
  it("inserts default value when field is empty", () => {
    const field: ManifestField = { type: "select", default: "to-read" };
    const fm: Record<string, unknown> = {};
    const changed = applyAutoFix("status", field, fm);
    expect(fm["status"]).toBe("to-read");
    expect(changed).toBe(true);
  });

  it("does not overwrite existing value with default", () => {
    const field: ManifestField = { type: "select", default: "to-read" };
    const fm: Record<string, unknown> = { status: "reading" };
    const changed = applyAutoFix("status", field, fm);
    expect(fm["status"]).toBe("reading");
    expect(changed).toBe(false);
  });

  it("always sets fixed value, even if field has a value", () => {
    const field: ManifestField = { type: "text", fixed: "📚" };
    const fm: Record<string, unknown> = { icon: "something" };
    const changed = applyAutoFix("icon", field, fm);
    expect(fm["icon"]).toBe("📚");
    expect(changed).toBe(true);
  });

  it("does not mark changed when fixed value already matches", () => {
    const field: ManifestField = { type: "text", fixed: "📚" };
    const fm: Record<string, unknown> = { icon: "📚" };
    const changed = applyAutoFix("icon", field, fm);
    expect(changed).toBe(false);
  });

  it("sorts multiselect alphabetically when sort: alphabetical", () => {
    const field: ManifestField = { type: "multiselect", sort: "alphabetical" };
    const fm: Record<string, unknown> = { tags: ["c", "a", "b"] };
    const changed = applyAutoFix("tags", field, fm);
    expect(fm["tags"]).toEqual(["a", "b", "c"]);
    expect(changed).toBe(true);
  });

  it("does not mark changed when multiselect already sorted", () => {
    const field: ManifestField = { type: "multiselect", sort: "alphabetical" };
    const fm: Record<string, unknown> = { tags: ["a", "b", "c"] };
    const changed = applyAutoFix("tags", field, fm);
    expect(changed).toBe(false);
  });
});
