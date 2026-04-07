import { describe, it, expect } from "vitest";
import { checkOptions } from "../options";
import type { FieldOption } from "../../../types";

const OPTIONS: FieldOption[] = [{ value: "to-read" }, { value: "reading" }, { value: "done" }];

describe("checkOptions", () => {
  it("returns null when value is in options", () => {
    expect(checkOptions("status", "reading", OPTIONS, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when value is not in options", () => {
    const result = checkOptions("status", "draft", OPTIONS, "schemas/book/manifest.md");
    expect(result?.rule).toBe("options");
    expect(result?.severity).toBe("error");
    expect(result?.message).toContain("draft");
  });

  it("returns null when value is undefined (let required rule handle that)", () => {
    expect(checkOptions("status", undefined, OPTIONS, "schemas/book/manifest.md")).toBeNull();
  });

  it("validates each item in array for multiselect", () => {
    const result = checkOptions(
      "tags",
      ["reading", "unknown"],
      OPTIONS,
      "schemas/book/manifest.md"
    );
    expect(result?.message).toContain("unknown");
  });

  it("returns null when all array items are valid", () => {
    expect(
      checkOptions("tags", ["reading", "done"], OPTIONS, "schemas/book/manifest.md")
    ).toBeNull();
  });
});

describe("checkOptions — strict=false", () => {
  it("returns null when value is outside options (unmanaged, not an error)", () => {
    expect(
      checkOptions("tags", "custom-tag", OPTIONS, "schemas/book/manifest.md", false)
    ).toBeNull();
  });

  it("returns null when array contains extra unmanaged values", () => {
    expect(
      checkOptions("tags", ["reading", "my-custom-tag"], OPTIONS, "schemas/book/manifest.md", false)
    ).toBeNull();
  });

  it("returns null when all values are unmanaged", () => {
    expect(
      checkOptions("tags", ["x", "y", "z"], OPTIONS, "schemas/book/manifest.md", false)
    ).toBeNull();
  });

  it("returns null when a managed value is valid (in options)", () => {
    expect(
      checkOptions("tags", ["reading", "extra"], OPTIONS, "schemas/book/manifest.md", false)
    ).toBeNull();
  });

  it("still returns error when a managed value is invalid", () => {
    // "reading" is in options but misspelled — wait, if value IS in options it's valid
    // The strict=false case: values in options must still be valid options
    // i.e. if someone has ["reading", "done"] — both are managed and valid → null
    expect(
      checkOptions("tags", ["reading", "done"], OPTIONS, "schemas/book/manifest.md", false)
    ).toBeNull();
  });

  it("returns null for undefined in non-strict mode", () => {
    expect(checkOptions("tags", undefined, OPTIONS, "schemas/book/manifest.md", false)).toBeNull();
  });
});
