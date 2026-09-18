import { describe, expect, it } from "vitest";
import type { FieldOption } from "../../../types";
import { checkLinkSource } from "../link-source";

const ALLOWED: FieldOption[] = [{ value: "Alice" }, { value: "Bob" }];

describe("checkLinkSource", () => {
  it("returns null when linked note is in allowed source", () => {
    expect(checkLinkSource("author", "Alice", ALLOWED, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when linked note is not in allowed source", () => {
    const result = checkLinkSource("author", "Charlie", ALLOWED, "schemas/book/manifest.md");
    expect(result?.rule).toBe("link-source");
    expect(result?.severity).toBe("error");
  });

  it("returns null when value is undefined", () => {
    expect(checkLinkSource("author", undefined, ALLOWED, "schemas/book/manifest.md")).toBeNull();
  });

  it("validates each item in multilink array", () => {
    const result = checkLinkSource(
      "authors",
      ["Alice", "Nobody"],
      ALLOWED,
      "schemas/book/manifest.md"
    );
    expect(result?.message).toContain("Nobody");
  });

  it("strips wikilink brackets before matching", () => {
    expect(checkLinkSource("author", "[[Alice]]", ALLOWED, "schemas/book/manifest.md")).toBeNull();
  });

  it("strips wikilink alias before matching", () => {
    expect(
      checkLinkSource("author", "[[Alice|A. Smith]]", ALLOWED, "schemas/book/manifest.md")
    ).toBeNull();
  });

  it("strips folder path from wikilink before matching", () => {
    expect(
      checkLinkSource("author", "[[People/Alice]]", ALLOWED, "schemas/book/manifest.md")
    ).toBeNull();
  });

  it("strips folder path and alias from wikilink before matching", () => {
    expect(
      checkLinkSource("author", "[[People/Alice|A. Smith]]", ALLOWED, "schemas/book/manifest.md")
    ).toBeNull();
  });
});

describe("checkLinkSource link forms", () => {
  const allowed: FieldOption[] = [{ value: "My Book" }];

  it.each([
    "[[My Book]]",
    "[[My Book.md]]",
    "[[projects/My Book/My Book.md|My Book]]",
    "[[My Book#Chapter 1]]",
    "[[folder/My Book.md#^abc|alias]]",
    "My Book",
  ])("accepts %s", (value) => {
    expect(checkLinkSource("up", value, allowed, "s/manifest.md")).toBeNull();
  });

  it("still rejects a different note written with an extension", () => {
    const result = checkLinkSource("up", "[[Other.md]]", allowed, "s/manifest.md");
    expect(result?.rule).toBe("link-source");
    expect(result?.message).toContain("[[Other.md]]");
  });

  it("checks every value of a list", () => {
    const result = checkLinkSource(
      "up",
      ["[[projects/My Book/My Book.md|My Book]]", "[[Other]]"],
      allowed,
      "s/manifest.md"
    );
    expect(result?.message).toContain("[[Other]]");
    expect(result?.message).not.toContain("My Book.md");
  });
});
