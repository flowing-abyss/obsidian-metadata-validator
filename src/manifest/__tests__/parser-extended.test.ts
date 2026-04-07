import { describe, it, expect } from "vitest";
import { parseManifest } from "../parser";

// Extended tests for the minimal YAML fallback parser.
// The basic happy-path cases live in parser.test.ts.

describe("parseManifest — scalar types", () => {
  it("parses boolean true/false", () => {
    const raw = `---
required: true
hidden: false
---`;
    const r = parseManifest(raw);
    expect(r.required).toBe(true);
    expect(r.hidden).toBe(false);
  });

  it("parses null and ~", () => {
    const raw = `---
a: null
b: ~
---`;
    const r = parseManifest(raw) as Record<string, unknown>;
    expect(r["a"]).toBeNull();
    expect(r["b"]).toBeNull();
  });

  it("parses integers and floats", () => {
    const raw = `---
priority: 10
score: 3.5
---`;
    const r = parseManifest(raw);
    expect(r.priority).toBe(10);
    expect((r as Record<string, unknown>)["score"]).toBe(3.5);
  });

  it("parses negative numbers", () => {
    const raw = `---
offset: -5
---`;
    const r = parseManifest(raw) as Record<string, unknown>;
    expect(r["offset"]).toBe(-5);
  });

  it("strips surrounding quotes from quoted strings", () => {
    const raw = `---
name: "My Schema"
alt: 'Another'
---`;
    const r = parseManifest(raw);
    expect(r.name).toBe("My Schema");
    expect((r as Record<string, unknown>)["alt"]).toBe("Another");
  });

  it("parses YAML flow sequence [a, b, c]", () => {
    const raw = `---
exclude: [rating, creator]
---`;
    const r = parseManifest(raw);
    expect(r.exclude).toEqual(["rating", "creator"]);
  });
});

describe("parseManifest — arrays", () => {
  it("parses a block array of strings", () => {
    const raw = `---
exclude:
  - rating
  - creator
---`;
    const r = parseManifest(raw);
    expect(r.exclude).toEqual(["rating", "creator"]);
  });

  it("parses inline array items with key: value", () => {
    const raw = `---
fields:
  status:
    type: select
    options:
      - value: "to-read"
        label: To Read
      - value: reading
---`;
    const r = parseManifest(raw);
    const opts = r.fields?.status?.options;
    expect(Array.isArray(opts)).toBe(true);
    const arr = opts as Array<{ value: string; label?: string }>;
    expect(arr[0]?.value).toBe("to-read");
    expect(arr[0]?.label).toBe("To Read");
    expect(arr[1]?.value).toBe("reading");
  });
});

describe("parseManifest — nested objects", () => {
  it("parses deeply nested target.query", () => {
    const raw = `---
target:
  query: '"Books/"'
---`;
    const r = parseManifest(raw);
    expect(r.target?.query).toBe('"Books/"');
  });

  it("parses formatting.property_order", () => {
    const raw = `---
formatting:
  property_order:
    - title
    - author
    - date
---`;
    const r = parseManifest(raw);
    expect(r.formatting?.property_order).toEqual(["title", "author", "date"]);
  });
});

describe("parseManifest — comments and blank lines", () => {
  it("ignores comment lines", () => {
    const raw = `---
# this is a comment
name: book
---`;
    const r = parseManifest(raw);
    expect(r.name).toBe("book");
  });

  it("handles blank lines inside frontmatter", () => {
    const raw = `---
name: book

priority: 5
---`;
    const r = parseManifest(raw);
    expect(r.name).toBe("book");
    expect(r.priority).toBe(5);
  });
});

describe("parseManifest — full field definition", () => {
  it("parses a complete field with all common properties", () => {
    const raw = `---
fields:
  rating:
    type: number
    required: true
    min: 1
    max: 5
    default: 3
---`;
    const r = parseManifest(raw);
    const f = r.fields?.rating;
    expect(f?.type).toBe("number");
    expect(f?.required).toBe(true);
    expect(f?.min).toBe(1);
    expect(f?.max).toBe(5);
    expect(f?.default).toBe(3);
  });

  it("parses dynamic options source", () => {
    const raw = `---
fields:
  tags:
    type: multiselect
    strict: false
    options:
      source:
        js: "return getTags()"
---`;
    const r = parseManifest(raw);
    const f = r.fields?.tags;
    expect(f?.strict).toBe(false);
    const opts = f?.options as { source: { js: string } } | undefined;
    expect(opts?.source?.js).toBe("return getTags()");
  });
});
