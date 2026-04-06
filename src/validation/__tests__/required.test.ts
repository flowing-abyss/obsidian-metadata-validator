import { describe, it, expect } from "vitest";
import { checkRequired } from "../rules/required";

describe("checkRequired", () => {
  it("returns null when value is a non-empty string", () => {
    expect(checkRequired("title", "hello", "m.md")).toBeNull();
  });

  it("returns null when value is 0", () => {
    expect(checkRequired("count", 0, "m.md")).toBeNull();
  });

  it("returns null when value is false", () => {
    expect(checkRequired("active", false, "m.md")).toBeNull();
  });

  it("returns error when value is null (auto-inserted placeholder for required field)", () => {
    const result = checkRequired("title", null, "m.md");
    expect(result).not.toBeNull();
    expect(result?.rule).toBe("required");
    expect(result?.severity).toBe("error");
  });

  it("returns null when value is empty string (key present but empty)", () => {
    expect(checkRequired("title", "", "m.md")).toBeNull();
  });

  it("returns null when value is empty array (key present but empty)", () => {
    expect(checkRequired("tags", [], "m.md")).toBeNull();
  });

  it("returns error when value is undefined (key absent)", () => {
    const result = checkRequired("title", undefined, "m.md");
    expect(result).not.toBeNull();
    expect(result?.rule).toBe("required");
    expect(result?.severity).toBe("error");
    expect(result?.autoFixed).toBe(false);
  });
});
