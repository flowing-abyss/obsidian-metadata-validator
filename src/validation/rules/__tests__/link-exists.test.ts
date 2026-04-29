import { describe, it, expect, vi } from "vitest";
import { checkLinkExists } from "../link-exists";
import type { App } from "obsidian";

const PATH = "schemas/book/manifest.md";
const SOURCE = "Books/MyBook.md";

function makeApp(resolves: Record<string, boolean>): App {
  return {
    metadataCache: {
      getFirstLinkpathDest: vi.fn((linkpath: string) =>
        resolves[linkpath] ? { path: linkpath + ".md" } : null
      ),
    },
  } as unknown as App;
}

describe("checkLinkExists", () => {
  it("returns null when value is undefined", () => {
    expect(checkLinkExists("author", undefined, makeApp({}), PATH, SOURCE)).toBeNull();
  });

  it("returns null when value is null", () => {
    expect(checkLinkExists("author", null, makeApp({}), PATH, SOURCE)).toBeNull();
  });

  it("returns null when value is empty string", () => {
    expect(checkLinkExists("author", "", makeApp({}), PATH, SOURCE)).toBeNull();
  });

  it("returns null when plain basename resolves", () => {
    const app = makeApp({ Alice: true });
    expect(checkLinkExists("author", "Alice", app, PATH, SOURCE)).toBeNull();
  });

  it("returns error when plain basename does not resolve", () => {
    const app = makeApp({});
    const r = checkLinkExists("author", "Nobody", app, PATH, SOURCE);
    expect(r?.rule).toBe("link-exists");
    expect(r?.severity).toBe("error");
    expect(r?.message).toContain("Nobody");
  });

  it("strips [[ ]] and resolves wikilink", () => {
    const app = makeApp({ Alice: true });
    expect(checkLinkExists("author", "[[Alice]]", app, PATH, SOURCE)).toBeNull();
  });

  it("strips alias from wikilink [[Name|Alias]]", () => {
    const app = makeApp({ Alice: true });
    expect(checkLinkExists("author", "[[Alice|A. Smith]]", app, PATH, SOURCE)).toBeNull();
  });

  it("strips .md extension", () => {
    const app = makeApp({ Alice: true });
    expect(checkLinkExists("author", "Alice.md", app, PATH, SOURCE)).toBeNull();
  });

  it("validates each item in an array (multilink)", () => {
    const app = makeApp({ Alice: true });
    const r = checkLinkExists("authors", ["Alice", "Nobody"], app, PATH, SOURCE);
    expect(r?.message).toContain("Nobody");
    expect(r?.message).not.toContain("Alice");
  });

  it("returns null when all array items resolve", () => {
    const app = makeApp({ Alice: true, Bob: true });
    expect(checkLinkExists("authors", ["Alice", "Bob"], app, PATH, SOURCE)).toBeNull();
  });

  it("returns error when wikilink target is empty after stripping", () => {
    const app = makeApp({});
    const r = checkLinkExists("author", "[[|]]", app, PATH, SOURCE);
    expect(r?.rule).toBe("link-exists");
    expect(r?.message).toContain("author");
  });

  it("includes field name and manifestPath in the result", () => {
    const app = makeApp({});
    const r = checkLinkExists("creator", "Unknown", app, PATH, SOURCE);
    expect(r?.field).toBe("creator");
    expect(r?.manifestPath).toBe(PATH);
    expect(r?.autoFixed).toBe(false);
  });
});
