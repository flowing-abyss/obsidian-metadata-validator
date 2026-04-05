import { describe, it, expect } from "vitest";
import { parseManifest } from "../parser";

describe("parseManifest", () => {
  it("parses valid frontmatter into ManifestData", () => {
    const raw = `---
name: book
target:
  folder: "Books/"
  tag: "#book"
fields:
  status:
    type: select
    required: true
    default: "to-read"
    options:
      - value: "📖"
        label: "In progress"
      - value: "✅"
        label: "Done"
  rating:
    type: number
    min: 1
    max: 5
---
Some body text here that should be ignored.`;

    const result = parseManifest(raw);

    expect(result.name).toBe("book");
    expect(result.target?.folder).toBe("Books/");
    expect(result.target?.tag).toBe("#book");
    expect(result.fields?.status?.type).toBe("select");
    expect(result.fields?.status?.required).toBe(true);
    expect(result.fields?.status?.default).toBe("to-read");
    expect(Array.isArray(result.fields?.status?.options)).toBe(true);
    expect(result.fields?.rating?.min).toBe(1);
  });

  it("returns empty object for file with no frontmatter", () => {
    const result = parseManifest("Just a markdown file with no frontmatter.");
    expect(result).toEqual({});
  });

  it("returns empty object for file with empty frontmatter", () => {
    const result = parseManifest("---\n---\nBody text.");
    expect(result).toEqual({});
  });

  it("handles extends field", () => {
    const raw = `---
name: movie
extends: "schemas/resource"
fields:
  director:
    type: link
---`;
    const result = parseManifest(raw);
    expect(result.extends).toBe("schemas/resource");
    expect(result.fields?.director?.type).toBe("link");
  });

  it("handles js source in field", () => {
    const raw = `---
fields:
  author:
    type: link
    source:
      js: "return dv.pages()"
---`;
    const result = parseManifest(raw);
    expect(result.fields?.author?.source?.js).toBe("return dv.pages()");
  });
});
