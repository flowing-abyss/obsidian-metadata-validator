import { describe, it, expect } from "vitest";
import { checkRequired } from "../required";

describe("checkRequired", () => {
  it("returns null when field has a value", () => {
    expect(checkRequired("author", "Alice", "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when required field is undefined", () => {
    const result = checkRequired("author", undefined, "schemas/book/manifest.md");
    expect(result?.field).toBe("author");
    expect(result?.rule).toBe("required");
    expect(result?.severity).toBe("error");
  });

  it("returns null when required field is empty string (key present but empty)", () => {
    expect(checkRequired("author", "", "schemas/book/manifest.md")).toBeNull();
  });

  it("returns null when required field is empty array (key present but empty)", () => {
    expect(checkRequired("tags", [], "schemas/book/manifest.md")).toBeNull();
  });

  it("returns null when value is 0 (falsy but valid)", () => {
    expect(checkRequired("rating", 0, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns null when value is false (falsy but valid)", () => {
    expect(checkRequired("active", false, "schemas/book/manifest.md")).toBeNull();
  });
});
