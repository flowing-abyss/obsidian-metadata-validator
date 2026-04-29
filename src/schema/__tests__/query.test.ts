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
		expect(evaluateQuery("#source", "Notes/n.md", ["source/book"], fm)).toBe(
			true,
		);
	});

	it("AND: both must match", () => {
		expect(
			evaluateQuery('"Books/" AND #book', "Books/Dune.md", ["book"], fm),
		).toBe(true);
		expect(
			evaluateQuery('"Books/" AND #book', "Books/Dune.md", ["article"], fm),
		).toBe(false);
		expect(
			evaluateQuery('"Books/" AND #book', "Movies/Dune.md", ["book"], fm),
		).toBe(false);
	});

	it("OR: either matches", () => {
		expect(
			evaluateQuery('"Books/" OR "Movies/"', "Movies/Dune.md", [], fm),
		).toBe(true);
		expect(evaluateQuery('"Books/" OR "Movies/"', "Notes/x.md", [], fm)).toBe(
			false,
		);
	});

	it("case-insensitive operators", () => {
		expect(
			evaluateQuery('"Books/" and #book', "Books/Dune.md", ["book"], fm),
		).toBe(true);
		expect(
			evaluateQuery('"Books/" or "Movies/"', "Movies/Dune.md", [], fm),
		).toBe(true);
	});

	it("property match", () => {
		expect(evaluateQuery("status=reading", "Notes/n.md", [], fm)).toBe(true);
		expect(evaluateQuery("status=done", "Notes/n.md", [], fm)).toBe(false);
	});

	it("supports unary negation with dash", () => {
		expect(evaluateQuery("#tag1 AND -#tag2", "Notes/n.md", ["tag1"], fm)).toBe(
			true,
		);
		expect(
			evaluateQuery("#tag1 AND -#tag2", "Notes/n.md", ["tag1", "tag2"], fm),
		).toBe(false);
	});

	it("supports unary negation with NOT", () => {
		expect(
			evaluateQuery("#tag1 AND NOT #tag2", "Notes/n.md", ["tag1"], fm),
		).toBe(true);
		expect(
			evaluateQuery("#tag1 AND NOT #tag2", "Notes/n.md", ["tag1", "tag2"], fm),
		).toBe(false);
	});

	it("supports negation for folders", () => {
		expect(evaluateQuery('-"Archive/"', "Notes/n.md", [], fm)).toBe(true);
		expect(evaluateQuery('-"Archive/"', "Archive/n.md", [], fm)).toBe(false);
	});

	it("supports parentheses grouping", () => {
		expect(
			evaluateQuery(
				"(#book OR #article) AND status=reading",
				"Notes/n.md",
				["book"],
				fm,
			),
		).toBe(true);
		expect(
			evaluateQuery(
				"(#book OR #article) AND status=reading",
				"Notes/n.md",
				["article"],
				fm,
			),
		).toBe(true);
		expect(
			evaluateQuery(
				"(#book OR #article) AND status=reading",
				"Notes/n.md",
				["news"],
				fm,
			),
		).toBe(false);
	});

	it("supports negation of grouped expressions", () => {
		expect(
			evaluateQuery("-(#book OR #article)", "Notes/n.md", ["news"], fm),
		).toBe(true);
		expect(
			evaluateQuery("-(#book OR #article)", "Notes/n.md", ["book"], fm),
		).toBe(false);
	});

	it("returns false for unrecognized term", () => {
		expect(evaluateQuery("unknownTerm", "Notes/n.md", [], fm)).toBe(false);
	});
});
