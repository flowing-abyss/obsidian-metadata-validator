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
