import { describe, it, expect, vi } from "vitest";
import { SchemaResolver } from "../resolver";
import { ManifestCache } from "../../manifest/cache";
import type { Manifest } from "../../types";
import type { App, TFile } from "obsidian";

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
  it("matches note to schema by folder", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { folder: "Books/" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("book");
  });

  it("matches note to schema by tag", () => {
    const cache = makeCache([
      {
        path: "schemas/article/manifest.md",
        folderPath: "schemas/article",
        data: { name: "article", target: { tag: "#article" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Some Article.md", ["#article"]);
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("article");
  });

  it("returns null when no manifest matches", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { folder: "Books/" }, fields: {} },
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
        target: { folder: "Books/" },
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
        target: { folder: "Books/" },
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
