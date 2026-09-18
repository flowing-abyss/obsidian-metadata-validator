import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { ManifestCache } from "../../manifest/cache";
import type { Manifest, ManifestRule } from "../../types";
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
  } as unknown as TFile & {
    tags: string[];
    frontmatter: Record<string, unknown>;
  };
}

describe("SchemaResolver", () => {
  it("keeps ancestor help separate from a missing child description", () => {
    const cache = makeCache([
      {
        path: "schemas/manifest.md",
        folderPath: "schemas",
        data: {
          name: "Source",
          description: "A source.",
          fields: {
            status: {
              type: "select",
              description: "Work stage.",
              options: [{ value: "done", description: "Work is complete." }],
            },
          },
        },
      },
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "Book", target: { query: "#book" } },
      },
    ]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    const schema = resolver.resolveForNote(makeFile("Books/Dune.md"), { tags: ["book"] });
    expect(schema?.description).toBeUndefined();
    expect(schema?.manifestSummaries?.[0]).toMatchObject({
      name: "Source",
      description: "A source.",
    });
    expect(schema?.fields.status?.description).toBe("Work stage.");
    expect(schema?.fields.status?.options).toEqual([
      { value: "done", description: "Work is complete." },
    ]);
  });
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
      data: {
        name: "sources",
        target: { query: "#source" },
        fields: { url: { type: "url" } },
      },
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

  it("setCache updates the internal cache reference", () => {
    const cache1 = makeCache([
      {
        path: "schemas/a/manifest.md",
        folderPath: "schemas/a",
        data: { name: "a", target: { query: '"A/"' }, fields: {} },
      },
    ]);
    const resolver = new SchemaResolver(cache1);
    resolver.rebuild();

    const cache2 = makeCache([
      {
        path: "schemas/b/manifest.md",
        folderPath: "schemas/b",
        data: { name: "b", target: { query: '"B/"' }, fields: {} },
      },
    ]);
    resolver.setCache(cache2);
    resolver.rebuild();

    const file = makeFile("B/Test.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("b");
  });

  it("circular inheritance returns null and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a: Manifest = {
      path: "schemas/a/manifest.md",
      folderPath: "schemas/a",
      data: { name: "a", target: {}, extends: "schemas/b", fields: {} },
    };
    const b: Manifest = {
      path: "schemas/b/manifest.md",
      folderPath: "schemas/b",
      data: { name: "b", target: {}, extends: "schemas/a", fields: {} },
    };

    const cache = makeCache([a, b]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    expect(resolver.resolveForNote(makeFile("Notes/X.md"), {})).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handles string tags in frontmatter", () => {
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
    const schema = resolver.resolveForNote(file, { tags: "article" });
    expect(schema?.name).toBe("article");
  });

  it("returns single match without sorting", () => {
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

  it("matches note by property target", () => {
    const cache = makeCache([
      {
        path: "schemas/task/manifest.md",
        folderPath: "schemas/task",
        data: {
          name: "task",
          target: { property: { type: "task" } },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Todo.md");
    const schema = resolver.resolveForNote(file, { type: "task" });
    expect(schema?.name).toBe("task");
  });

  it("priority wins over lower priority schemas", () => {
    const cache = makeCache([
      {
        path: "schemas/low/manifest.md",
        folderPath: "schemas/low",
        data: {
          name: "low",
          priority: 0,
          target: { query: '"Notes/"' },
          fields: {},
        },
      },
      {
        path: "schemas/high/manifest.md",
        folderPath: "schemas/high",
        data: {
          name: "high",
          priority: 10,
          target: { query: '"Notes/"' },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/X.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("high");
  });

  it("deeper inheritance chain wins when priority is tied", () => {
    const cache = makeCache([
      {
        path: "schemas/base/manifest.md",
        folderPath: "schemas/base",
        data: {
          name: "base",
          priority: 5,
          target: { query: '"Notes/"' },
          fields: {},
        },
      },
      {
        path: "schemas/base/child/manifest.md",
        folderPath: "schemas/base/child",
        data: {
          name: "child",
          priority: 5,
          target: { query: '"Notes/"' },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/X.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("child");
  });

  it("query target wins over property target when priority is tied", () => {
    const cache = makeCache([
      {
        path: "schemas/prop/manifest.md",
        folderPath: "schemas/prop",
        data: {
          name: "prop",
          priority: 5,
          target: { property: { type: "note" } },
          fields: {},
        },
      },
      {
        path: "schemas/query/manifest.md",
        folderPath: "schemas/query",
        data: {
          name: "query",
          priority: 5,
          target: { query: '"Notes/"' },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/X.md");
    const schema = resolver.resolveForNote(file, { type: "note" });
    expect(schema?.name).toBe("query");
  });

  it("handles extends with manifest.md suffix", () => {
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: { name: "base", target: {}, fields: { url: { type: "url" } } },
    };
    const child: Manifest = {
      path: "schemas/child/manifest.md",
      folderPath: "schemas/child",
      data: {
        name: "child",
        extends: "schemas/base/manifest.md",
        target: { query: '"Child/"' },
        fields: {},
      },
    };

    const cache = makeCache([base, child]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Child/X.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.fields["url"]?.type).toBe("url");
  });

  it("handles null frontmatter value in property target", () => {
    const cache = makeCache([
      {
        path: "schemas/task/manifest.md",
        folderPath: "schemas/task",
        data: {
          name: "task",
          target: { property: { type: "task" } },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Todo.md");
    const schema = resolver.resolveForNote(file, { type: null });
    expect(schema).toBeNull();
  });

  it("handles empty string tags in frontmatter", () => {
    const cache = makeCache([
      {
        path: "schemas/article/manifest.md",
        folderPath: "schemas/article",
        data: {
          name: "article",
          target: { query: "#article" },
          fields: {},
        },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Article.md");
    const schema = resolver.resolveForNote(file, { tags: "" });
    expect(schema).toBeNull();
  });
});

describe("SchemaResolver rules", () => {
  function makeCacheWithRules(
    manifests: Manifest[],
    rulesFiles: Array<{ path: string; folderPath: string; rules: ManifestRule[] }>
  ): ManifestCache {
    const cache = makeCache(manifests);
    vi.spyOn(cache, "getByPath").mockImplementation((p: string) =>
      manifests.find((m) => m.path === p)
    );
    vi.spyOn(cache, "getRulesFilesForFolder").mockImplementation((folder: string) =>
      rulesFiles
        .filter((r) => folder === r.folderPath || folder.startsWith(r.folderPath + "/"))
        .sort((a, b) => a.folderPath.split("/").length - b.folderPath.split("/").length)
    );
    return cache;
  }

  const rule = (name: string): ManifestRule => ({ name, then: { set: { [name]: 1 } } });

  it("orders all rules.md files (outer first) before the manifest chain", () => {
    const cache = makeCacheWithRules(
      [
        {
          path: "schemas/manifest.md",
          folderPath: "schemas",
          data: { rules: [rule("root-manifest")] },
        },
        {
          path: "schemas/projects/manifest.md",
          folderPath: "schemas/projects",
          data: { target: { query: "#project" }, rules: [rule("project-manifest")] },
        },
      ],
      [
        { path: "schemas/rules.md", folderPath: "schemas", rules: [rule("root-rules")] },
        {
          path: "schemas/projects/rules.md",
          folderPath: "schemas/projects",
          rules: [rule("project-rules")],
        },
      ]
    );
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    const schema = resolver.resolveForNote(makeFile("p/x.md"), { tags: ["project"] });
    expect(schema?.rules.map((r) => r.name)).toEqual([
      "root-rules",
      "project-rules",
      "root-manifest",
      "project-manifest",
    ]);
  });

  it("follows the extends chain, not folder depth", () => {
    const cache = makeCacheWithRules(
      [
        {
          path: "schemas/x/y/z/manifest.md",
          folderPath: "schemas/x/y/z",
          data: { rules: [rule("parent"), { name: "shared", then: { set: { from: "parent" } } }] },
        },
        {
          path: "schemas/a/manifest.md",
          folderPath: "schemas/a",
          data: {
            target: { query: "#a" },
            extends: "schemas/x/y/z",
            rules: [{ name: "shared", then: { set: { from: "child" } } }, rule("child")],
          },
        },
      ],
      []
    );
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    const schema = resolver.resolveForNote(makeFile("n.md"), { tags: ["a"] });
    expect(schema?.rules).toEqual([
      { name: "parent", then: { set: { parent: 1 } } },
      { name: "shared", then: { set: { from: "child" } } },
      { name: "child", then: { set: { child: 1 } } },
    ]);
  });

  it("survives a manifest whose rules is not a list", () => {
    const cache = makeCacheWithRules(
      [
        {
          path: "schemas/a/manifest.md",
          folderPath: "schemas/a",
          data: { target: { query: "#a" }, rules: { when: "x", then: {} } as never },
        },
      ],
      []
    );
    const resolver = new SchemaResolver(cache);
    expect(() => resolver.rebuild()).not.toThrow();
    expect(resolver.resolveForNote(makeFile("n.md"), { tags: ["a"] })?.rules).toEqual([]);
  });

  it("replaces by name across layers and honours exclude", () => {
    const cache = makeCacheWithRules(
      [
        {
          path: "schemas/manifest.md",
          folderPath: "schemas",
          data: { rules: [rule("keep"), rule("drop")] },
        },
        {
          path: "schemas/projects/manifest.md",
          folderPath: "schemas/projects",
          data: {
            target: { query: "#project" },
            exclude: ["drop"],
            rules: [{ name: "keep", then: { set: { replaced: true } } }],
          },
        },
      ],
      []
    );
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    const schema = resolver.resolveForNote(makeFile("p/x.md"), { tags: ["project"] });
    expect(schema?.rules).toEqual([{ name: "keep", then: { set: { replaced: true } } }]);
  });

  it("manifest without rules resolves to an empty list", () => {
    const cache = makeCacheWithRules(
      [
        {
          path: "schemas/a/manifest.md",
          folderPath: "schemas/a",
          data: { target: { query: "#a" } },
        },
      ],
      []
    );
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    expect(resolver.resolveForNote(makeFile("x.md"), { tags: ["a"] })?.rules).toEqual([]);
  });
});

describe("SchemaResolver parse errors", () => {
  it("collects YAML errors from the chain and from rules.md files", () => {
    const manifests: Manifest[] = [
      {
        path: "schemas/manifest.md",
        folderPath: "schemas",
        data: { parseError: "duplicated mapping key" },
      },
      {
        path: "schemas/a/manifest.md",
        folderPath: "schemas/a",
        data: { target: { query: "#a" } },
      },
    ];
    const cache = makeCache(manifests);
    vi.spyOn(cache, "getByPath").mockImplementation((p: string) =>
      manifests.find((m) => m.path === p)
    );
    vi.spyOn(cache, "getRulesFilesForFolder").mockReturnValue([
      { path: "schemas/rules.md", folderPath: "schemas", rules: [], parseError: "bad indent" },
    ]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();
    const schema = resolver.resolveForNote(makeFile("n.md"), { tags: ["a"] });
    expect(schema?.parseErrors).toEqual([
      "schemas/rules.md: bad indent",
      "schemas/manifest.md: duplicated mapping key",
    ]);
  });
});
