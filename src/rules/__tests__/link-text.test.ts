import { describe, expect, it } from "vitest";
import { isWikiLink, linkName, linkTarget, valueText, valuesEqual } from "../link-text";

describe("link-text", () => {
  it("detects wiki links", () => {
    expect(isWikiLink("[[x]]")).toBe(true);
    expect(isWikiLink(" [[x]] ")).toBe(true);
    expect(isWikiLink("x")).toBe(false);
    expect(isWikiLink(5)).toBe(false);
    expect(isWikiLink(null)).toBe(false);
  });

  it("extracts link target without alias or extension", () => {
    expect(linkTarget("[[base/x|Икс]]")).toBe("base/x");
    expect(linkTarget("[[x.md]]")).toBe("x");
    expect(linkTarget("plain")).toBe("plain");
  });

  it("extracts link name", () => {
    expect(linkName("[[base/x|Икс]]")).toBe("x");
    expect(linkName("[[x]]")).toBe("x");
  });

  it("renders primitive text and JSON for objects", () => {
    expect(valueText(null)).toBe("");
    expect(valueText(undefined)).toBe("");
    expect(valueText("a")).toBe("a");
    expect(valueText(3)).toBe("3");
    expect(valueText(true)).toBe("true");
    expect(valueText({ a: 1 })).toBe('{"a":1}');
  });

  it("compares links by name and strings exactly", () => {
    expect(valuesEqual("[[a/x]]", "[[x]]")).toBe(true);
    expect(valuesEqual("[[x]]", "x")).toBe(true);
    expect(valuesEqual("status/done", "status/done")).toBe(true);
    expect(valuesEqual("a", "A")).toBe(false);
    expect(valuesEqual(1, "1")).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
    expect(valuesEqual(null, "x")).toBe(false);
  });
});
