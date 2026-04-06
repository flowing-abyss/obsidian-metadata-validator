import { describe, it, expect } from "vitest";
import { evaluateQuery } from "../query";

describe("evaluateQuery", () => {
  const fm: Record<string, unknown> = { status: "reading", rating: 5 };

  it("matches by folder", () => {
    expect(evaluateQuery('"Books/"', "Books/Dune.md", [], fm)).toBe(true);
    expect(evaluateQuery('"Books/"', "Movies/Dune.md", [], fm)).toBe(false);
  });

  it("matches by folder without quotes", () => {
    expect(evaluateQuery("Books/", "Books/Dune.md", [], fm)).toBe(true);
  });

  it("matches by tag", () => {
    expect(evaluateQuery("#book", "Notes/n.md", ["book"], fm)).toBe(true);
    expect(evaluateQuery("#book", "Notes/n.md", ["article"], fm)).toBe(false);
  });

  it("matches child tag", () => {
    expect(evaluateQuery("#source", "Notes/n.md", ["source/book"], fm)).toBe(true);
  });

  it("AND: both must match", () => {
    expect(evaluateQuery('"Books/" AND #book', "Books/Dune.md", ["book"], fm)).toBe(true);
    expect(evaluateQuery('"Books/" AND #book', "Books/Dune.md", ["article"], fm)).toBe(false);
    expect(evaluateQuery('"Books/" AND #book', "Movies/Dune.md", ["book"], fm)).toBe(false);
  });

  it("OR: either matches", () => {
    expect(evaluateQuery('"Books/" OR "Movies/"', "Movies/Dune.md", [], fm)).toBe(true);
    expect(evaluateQuery('"Books/" OR "Movies/"', "Notes/x.md", [], fm)).toBe(false);
  });

  it("case-insensitive operators", () => {
    expect(evaluateQuery('"Books/" and #book', "Books/Dune.md", ["book"], fm)).toBe(true);
    expect(evaluateQuery('"Books/" or "Movies/"', "Movies/Dune.md", [], fm)).toBe(true);
  });

  it("property match", () => {
    expect(evaluateQuery("status=reading", "Notes/n.md", [], fm)).toBe(true);
    expect(evaluateQuery("status=done", "Notes/n.md", [], fm)).toBe(false);
  });
});
