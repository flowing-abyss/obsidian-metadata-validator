import { describe, expect, it } from "vitest";
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

  it("supports unary negation with dash", () => {
    expect(evaluateQuery("#tag1 AND -#tag2", "Notes/n.md", ["tag1"], fm)).toBe(true);
    expect(evaluateQuery("#tag1 AND -#tag2", "Notes/n.md", ["tag1", "tag2"], fm)).toBe(false);
  });

  it("supports unary negation with NOT", () => {
    expect(evaluateQuery("#tag1 AND NOT #tag2", "Notes/n.md", ["tag1"], fm)).toBe(true);
    expect(evaluateQuery("#tag1 AND NOT #tag2", "Notes/n.md", ["tag1", "tag2"], fm)).toBe(false);
  });

  it("supports negation for folders", () => {
    expect(evaluateQuery('-"Archive/"', "Notes/n.md", [], fm)).toBe(true);
    expect(evaluateQuery('-"Archive/"', "Archive/n.md", [], fm)).toBe(false);
  });

  it("supports parentheses grouping", () => {
    expect(
      evaluateQuery("(#book OR #article) AND status=reading", "Notes/n.md", ["book"], fm)
    ).toBe(true);
    expect(
      evaluateQuery("(#book OR #article) AND status=reading", "Notes/n.md", ["article"], fm)
    ).toBe(true);
    expect(
      evaluateQuery("(#book OR #article) AND status=reading", "Notes/n.md", ["news"], fm)
    ).toBe(false);
  });

  it("supports negation of grouped expressions", () => {
    expect(evaluateQuery("-(#book OR #article)", "Notes/n.md", ["news"], fm)).toBe(true);
    expect(evaluateQuery("-(#book OR #article)", "Notes/n.md", ["book"], fm)).toBe(false);
  });

  it("returns false for unrecognized term", () => {
    expect(evaluateQuery("unknownTerm", "Notes/n.md", [], fm)).toBe(false);
  });

  it("returns false for lone negation prefix", () => {
    expect(evaluateQuery("-", "Notes/n.md", [], fm)).toBe(false);
  });

  it("returns false for property match on missing key", () => {
    expect(evaluateQuery("missing=value", "Notes/n.md", [], fm)).toBe(false);
  });

  it("returns false for empty query", () => {
    expect(evaluateQuery("", "Notes/n.md", [], fm)).toBe(false);
  });
});

describe("evaluateQuery extensions", () => {
  const fm: Record<string, unknown> = {
    status: "🟩",
    end: null,
    tags: ["status/done", "category/x"],
    meta: ["[[base/information processing|IP]]"],
    rating: 8,
    start: "2026-01-05",
    created: "2026-01-05T10:00:00+07:00",
    updated: "2026-01-05T10:00:00+07:00",
    title: "My Note",
  };

  it("key= matches empty values", () => {
    expect(evaluateQuery("end=", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("missing=", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("status=", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("-end=", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("tags=", "n.md", [], { tags: [] })).toBe(true);
    expect(evaluateQuery("tags=x", "n.md", [], { tags: [] })).toBe(false);
  });

  it("= on a list means contains", () => {
    expect(evaluateQuery("tags=status/done", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("tags=status", "n.md", [], fm)).toBe(false);
  });

  it("= compares links by note name", () => {
    expect(evaluateQuery("meta=[[information processing]]", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("meta=[[other]]", "n.md", [], fm)).toBe(false);
  });

  it("numeric comparisons", () => {
    expect(evaluateQuery("rating>=8", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("rating>8", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("rating<10", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("rating<=7", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("rating <= 8", "n.md", [], fm)).toBe(true);
  });

  it("date comparisons at the coarser precision", () => {
    expect(evaluateQuery("start<2026-02-01", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created<2026-01-06", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created<2026-01-05", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("created>=2026-01-05", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created<2026-01-05T11:00:00+07:00", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created>2026-01-05T11:00:00+07:00", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("created=2026-01-05T10:00:00+07:00", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created>=2026-01-05T10:00:00+07:00", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("created<=2026-01-05T10:00:00+07:00", "n.md", [], fm)).toBe(true);
  });

  it("string comparisons fall back to locale order", () => {
    expect(evaluateQuery("status>a", "n.md", [], { status: "b" })).toBe(true);
    expect(evaluateQuery("status<a", "n.md", [], { status: "b" })).toBe(false);
  });

  it("comparison with empty is false, negation flips it", () => {
    expect(evaluateQuery("end<2026-01-01", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("-end<2026-01-01", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("rating<", "n.md", [], fm)).toBe(false);
    expect(evaluateQuery("tags<2", "n.md", [], { tags: [""] })).toBe(false);
  });

  it("quoted values with spaces and escaped quotes", () => {
    expect(evaluateQuery('title="My Note"', "n.md", [], fm)).toBe(true);
    expect(evaluateQuery("title='My Note'", "n.md", [], fm)).toBe(true);
    expect(evaluateQuery('title="My \\"Note\\""', "n.md", [], { title: 'My "Note"' })).toBe(true);
  });

  it("comparison on a list matches any element", () => {
    expect(evaluateQuery("scores>5", "n.md", [], { scores: [1, 9] })).toBe(true);
    expect(evaluateQuery("scores>10", "n.md", [], { scores: [1, 9] })).toBe(false);
  });
});
