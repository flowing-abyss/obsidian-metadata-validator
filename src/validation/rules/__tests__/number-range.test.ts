import { describe, it, expect } from "vitest";
import { checkNumberRange } from "../number-range";

describe("checkNumberRange", () => {
  it("returns null when value is within range", () => {
    expect(checkNumberRange("rating", 3, 1, 5, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when value is below min", () => {
    const result = checkNumberRange("rating", 0, 1, 5, "schemas/book/manifest.md");
    expect(result?.rule).toBe("number-range");
    expect(result?.message).toContain("1");
  });

  it("returns error when value is above max", () => {
    const result = checkNumberRange("rating", 6, 1, 5, "schemas/book/manifest.md");
    expect(result?.message).toContain("5");
  });

  it("returns null when value is undefined", () => {
    expect(checkNumberRange("rating", undefined, 1, 5, "schemas/book/manifest.md")).toBeNull();
  });

  it("handles min-only", () => {
    expect(checkNumberRange("score", 0, 0, undefined, "schemas/book/manifest.md")).toBeNull();
    expect(checkNumberRange("score", -1, 0, undefined, "schemas/book/manifest.md")).not.toBeNull();
  });
});
