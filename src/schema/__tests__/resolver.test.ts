import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { ManifestCache } from "../../manifest/cache";
import type { Manifest } from "../../types";
import { SchemaResolver } from "../resolver";

function makeCache(manifests: Manifest[]): ManifestCache {
  const cache = new ManifestCache({} as App, "schemas");
  vi.spyOn(cache, "getAll").mockReturnValue(manifests);
  vi.spyOn(cache, "getByFolder").mockImplementation((folder: string) =>
    manifests.find((m) => m.folderPath === folder)
  );
  return cache;
}

function makeFile(
  path: string,
  tags: string[] = [],
  frontmatter: Record<string, unknown> = {}
): TFile & { tags: string[]; frontmatter: Record<string, unknown> } {
  return {
    path,
    basename: path.split("/").pop() ?? "",
    extension: "md",
    tags,
    frontmatter,
  } as unknown as TFile & { tags: string[]; frontmatter: Record<string, unknown> };
}

describe("SchemaResolver", () => {
  it("matches note to schema by folder expression", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { query: '"Books/"' }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("book");
  });

  it("matches note to schema by tag expression", () => {
    const cache = makeCache([
      {
        path: "schemas/article/manifest.md",
        folderPath: "schemas/article",
        data: { name: "article", target: { query: "#article" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Some Article.md");
    const schema = resolver.resolveForNote(file, { tags: ["article"] });
    expect(schema?.name).toBe("article");
  });

  it("returns null when no manifest matches", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { query: '"Books/"' }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Movies/Dune.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema).toBeNull();
  });

  it("resolves inheritance chain via folder nesting", () => {
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: {
        name: "base",
        target: {},
        fields: { created: { type: "date" } },
      },
    };
    const book: Manifest = {
      path: "schemas/base/book/manifest.md",
      folderPath: "schemas/base/book",
      data: {
        name: "book",
        target: { query: '"Books/"' },
        fields: { rating: { type: "number" } },
      },
    };

    const cache = makeCache([base, book]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});

    expect(schema?.name).toBe("book");
    expect(schema?.fields["created"]?.type).toBe("date");
    expect(schema?.fields["rating"]?.type).toBe("number");
    expect(schema?.inheritanceChain).toEqual([
      "schemas/base/manifest.md",
      "schemas/base/book/manifest.md",
    ]);
  });

  it("inherits fields across deep folder nesting", () => {
    const category: Manifest = {
      path: "schemas/category/manifest.md",
      folderPath: "schemas/category",
      data: {
        name: "category",
        target: { query: "#taxonomy" },
        fields: { level0: { type: "text" } },
      },
    };
    const meta: Manifest = {
      path: "schemas/category/meta/manifest.md",
      folderPath: "schemas/category/meta",
      data: {
        name: "meta",
        fields: { level1: { type: "number" } },
      },
    };
    const problem: Manifest = {
      path: "schemas/category/meta/problem/manifest.md",
      folderPath: "schemas/category/meta/problem",
      data: {
        name: "problem",
        fields: { level2: { type: "date" } },
      },
    };
    const hierarchy: Manifest = {
      path: "schemas/category/meta/problem/hierarchy/manifest.md",
      folderPath: "schemas/category/meta/problem/hierarchy",
      data: {
        name: "hierarchy",
        fields: { level3: { type: "boolean" } },
      },
    };

    const cache = makeCache([category, meta, problem, hierarchy]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Deep.md");
    const schema = resolver.resolveForNote(file, { tags: ["taxonomy"] });

    expect(schema?.name).toBe("hierarchy");
    expect(schema?.fields["level0"]?.type).toBe("text");
    expect(schema?.fields["level1"]?.type).toBe("number");
    expect(schema?.fields["level2"]?.type).toBe("date");
    expect(schema?.fields["level3"]?.type).toBe("boolean");
    expect(schema?.inheritanceChain).toEqual([
      "schemas/category/manifest.md",
      "schemas/category/meta/manifest.md",
      "schemas/category/meta/problem/manifest.md",
      "schemas/category/meta/problem/hierarchy/manifest.md",
    ]);
  });

  it("child schema inherits parent target when child has no explicit target", () => {
    const parent: Manifest = {
      path: "schemas/sources/manifest.md",
      folderPath: "schemas/sources",
      data: { name: "sources", target: { query: "#source" }, fields: { url: { type: "url" } } },
    };
    const child: Manifest = {
      path: "schemas/sources/books/manifest.md",
      folderPath: "schemas/sources/books",
      data: { name: "books", fields: { rating: { type: "number" } } },
      // No target — should inherit from parent
    };

    const cache = makeCache([parent, child]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    // Note tagged "source" should match the child (books) schema via inherited target
    const file = makeFile("Notes/MyBook.md");
    const schema = resolver.resolveForNote(file, { tags: ["source"] });
    expect(schema?.name).toBe("books"); // child wins, inherits parent's target
    expect(schema?.fields["rating"]?.type).toBe("number"); // child field
    expect(schema?.fields["url"]?.type).toBe("url"); // inherited field
  });

  it("child schema wins over parent when both match via inherited target", () => {
    const parent: Manifest = {
      path: "schemas/sources/manifest.md",
      folderPath: "schemas/sources",
      data: { name: "sources", target: { query: "#source" }, fields: {} },
    };
    const child: Manifest = {
      path: "schemas/sources/books/manifest.md",
      folderPath: "schemas/sources/books",
      data: { name: "books", fields: {} },
    };

    const cache = makeCache([parent, child]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/MyBook.md");
    const schema = resolver.resolveForNote(file, { tags: ["source"] });
    expect(schema?.name).toBe("books"); // deeper chain = more specific
  });

  it("explicit extends overrides folder-nesting inheritance", () => {
    const resource: Manifest = {
      path: "schemas/resource/manifest.md",
      folderPath: "schemas/resource",
      data: { name: "resource", target: {}, fields: { url: { type: "url" } } },
    };
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: { name: "base", target: {}, fields: { created: { type: "date" } } },
    };
    const book: Manifest = {
      path: "schemas/base/book/manifest.md",
      folderPath: "schemas/base/book",
      data: {
        name: "book",
        extends: "schemas/resource",
        target: { query: '"Books/"' },
        fields: { rating: { type: "number" } },
      },
    };

    const cache = makeCache([base, resource, book]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});

    expect(schema?.fields["url"]?.type).toBe("url");
    expect(schema?.fields["created"]).toBeUndefined();
  });
});
