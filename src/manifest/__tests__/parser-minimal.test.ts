/**
 * Tests for the parseMinimal YAML fallback inside parseManifest.
 * We force it to run by mocking obsidian's parseYaml to throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	parseYaml: vi.fn(() => {
		throw new Error("obsidian parseYaml not available");
	}),
}));

// Import AFTER the mock is in place
const { parseManifest } = await import("../parser");

beforeEach(() => {
	vi.clearAllMocks();
});

describe("parseManifest (parseMinimal fallback)", () => {
	// ── no frontmatter ───────────────────────────────────────────────────────

	it("returns {} for file with no frontmatter", () => {
		expect(parseManifest("Just a regular markdown file")).toEqual({});
	});

	it("returns {} for empty frontmatter", () => {
		expect(parseManifest("---\n---")).toEqual({});
	});

	// ── scalars ──────────────────────────────────────────────────────────────

	it("parses string value", () => {
		const r = parseManifest("---\nname: book\n---");
		expect(r.name).toBe("book");
	});

	it("parses quoted string", () => {
		const r = parseManifest('---\nname: "My Book"\n---');
		expect(r.name).toBe("My Book");
	});

	it("parses integer", () => {
		const r = parseManifest("---\npriority: 5\n---");
		expect(r.priority).toBe(5);
	});

	it("parses float", () => {
		const r = parseManifest("---\nscore: 3.14\n---") as Record<string, unknown>;
		expect(r["score"]).toBe(3.14);
	});

	it("parses negative number", () => {
		const r = parseManifest("---\noffset: -2\n---") as Record<string, unknown>;
		expect(r["offset"]).toBe(-2);
	});

	it("parses boolean true", () => {
		const r = parseManifest("---\nrequired: true\n---") as Record<
			string,
			unknown
		>;
		expect(r["required"]).toBe(true);
	});

	it("parses boolean false", () => {
		const r = parseManifest("---\nhidden: false\n---") as Record<
			string,
			unknown
		>;
		expect(r["hidden"]).toBe(false);
	});

	it("parses null", () => {
		const r = parseManifest("---\ndefault: null\n---") as Record<
			string,
			unknown
		>;
		expect(r["default"]).toBeNull();
	});

	it("parses tilde as null", () => {
		const r = parseManifest("---\ndefault: ~\n---") as Record<string, unknown>;
		expect(r["default"]).toBeNull();
	});

	// ── flow sequence ─────────────────────────────────────────────────────────

	it("parses YAML flow sequence [a, b]", () => {
		const r = parseManifest("---\nexclude: [rating, creator]\n---");
		expect(r.exclude).toEqual(["rating", "creator"]);
	});

	// ── block arrays ─────────────────────────────────────────────────────────

	it("parses block array of strings", () => {
		const r = parseManifest("---\nexclude:\n  - rating\n  - creator\n---");
		expect(r.exclude).toEqual(["rating", "creator"]);
	});

	// ── nested objects ────────────────────────────────────────────────────────

	it("parses nested object", () => {
		const r = parseManifest("---\ntarget:\n  query: 'Books/'\n---");
		expect(r.target?.query).toBe("Books/");
	});

	it("parses field definition", () => {
		const raw = `---
fields:
  status:
    type: select
    required: true
---`;
		const r = parseManifest(raw);
		expect(r.fields?.status?.type).toBe("select");
		expect(r.fields?.status?.required).toBe(true);
	});

	it("parses options array with value/label pairs", () => {
		const raw = `---
fields:
  status:
    type: select
    options:
      - value: to-read
        label: "To Read"
      - value: done
---`;
		const r = parseManifest(raw);
		const opts = r.fields?.status?.options as
			| Array<{ value: string; label?: string }>
			| undefined;
		expect(Array.isArray(opts)).toBe(true);
		expect(opts?.[0]?.value).toBe("to-read");
		expect(opts?.[0]?.label).toBe("To Read");
		expect(opts?.[1]?.value).toBe("done");
	});

	it("ignores comment lines", () => {
		const raw = `---
# a comment
name: book
---`;
		const r = parseManifest(raw);
		expect(r.name).toBe("book");
	});

	it("handles blank lines in frontmatter", () => {
		const raw = `---
name: book

priority: 3
---`;
		const r = parseManifest(raw);
		expect(r.name).toBe("book");
		expect(r.priority).toBe(3);
	});

	it("parses extends field", () => {
		const raw = `---
extends: schemas/resource
---`;
		const r = parseManifest(raw);
		expect(r.extends).toBe("schemas/resource");
	});

	it("parses formatting.property_order", () => {
		const raw = `---
formatting:
  property_order:
    - title
    - author
---`;
		const r = parseManifest(raw);
		expect(r.formatting?.property_order).toEqual(["title", "author"]);
	});

	it("parses empty value as null when next line is not indented deeper", () => {
		const raw = `---
key:
other: value
---`;
		const r = parseManifest(raw) as Record<string, unknown>;
		expect(r["key"]).toBeNull();
		expect(r["other"]).toBe("value");
	});

	it("parses inline array starting on same line as key", () => {
		const raw = `---
tags: - a
  - b
---`;
		const r = parseManifest(raw);
		expect(r.tags).toEqual(["a", "b"]);
	});

	it("parses blank line inside block array", () => {
		const raw = `---
items:
  - a

  - b
---`;
		const r = parseManifest(raw);
		expect(r.items).toEqual(["a", "b"]);
	});

	it("parses nested array item with colon and additional properties", () => {
		const raw = `---
items:
  - name: test
    value: 1
---`;
		const r = parseManifest(raw);
		expect(r.items).toEqual([{ name: "test", value: 1 }]);
	});
});
