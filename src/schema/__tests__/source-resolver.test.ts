import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { resolveSource } from "../source-resolver";

type MockTFile = TFile;

function makeTFile(path: string): MockTFile {
  const dotIndex = path.lastIndexOf(".");
  const basename = dotIndex >= 0 ? path.slice(path.lastIndexOf("/") + 1, dotIndex) : path;
  const extension = dotIndex >= 0 ? path.slice(dotIndex + 1) : "";
  return { path, basename, extension } as unknown as MockTFile;
}

function makeApp(files: Array<{ path: string; tags: string[]; fm: Record<string, unknown> }>): App {
  const tfiles = files.map((f) => makeTFile(f.path));

  return {
    vault: { getMarkdownFiles: () => tfiles },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const found = files.find((x) => x.path === f.path);
        if (!found) return null;
        return {
          frontmatter: found.fm,
          tags: found.tags.map((tag) => ({ tag, position: {} })),
        };
      },
    },
  } as unknown as App;
}

function makeAppWithDataview(
  files: Array<{ path: string; tags: string[]; fm: Record<string, unknown> }>
): App {
  const app = makeApp(files) as unknown as Record<string, unknown>;
  app.plugins = {
    plugins: {
      dataview: {
        api: {
          page: () => null,
        },
      },
    },
  };
  return app as unknown as App;
}

describe("resolveSource", () => {
  it("filters by folder", async () => {
    const app = makeApp([
      { path: "People/Alice.md", tags: [], fm: {} },
      { path: "People/Bob.md", tags: [], fm: {} },
      { path: "Books/Dune.md", tags: [], fm: {} },
    ]);

    const result = await resolveSource({ folder: "People/" }, app, null);
    expect(result.map((r) => r.value).sort()).toEqual(["Alice", "Bob"]);
  });

  it("filters by tag", async () => {
    const app = makeApp([
      { path: "Notes/A.md", tags: ["#person"], fm: {} },
      { path: "Notes/B.md", tags: ["#book"], fm: {} },
    ]);

    const result = await resolveSource({ tag: "#person" }, app, null);
    expect(result.map((r) => r.value)).toEqual(["A"]);
  });

  it("filters by frontmatter property", async () => {
    const app = makeApp([
      {
        path: "People/Alice.md",
        tags: [],
        fm: { type: "person", active: "true" },
      },
      { path: "People/Bob.md", tags: [], fm: { type: "org" } },
    ]);

    const result = await resolveSource({ property: { type: "person" } }, app, null);
    expect(result.map((r) => r.value)).toEqual(["Alice"]);
  });

  it("combines folder + property with AND", async () => {
    const app = makeApp([
      { path: "People/Alice.md", tags: [], fm: { type: "person" } },
      { path: "People/Corp.md", tags: [], fm: { type: "org" } },
      { path: "Books/Some.md", tags: [], fm: { type: "person" } },
    ]);

    const result = await resolveSource(
      { folder: "People/", property: { type: "person" } },
      app,
      null
    );
    expect(result.map((r) => r.value)).toEqual(["Alice"]);
  });

  it("supports grouped JS source output", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `
          return [
            {
              group: "Status",
              type: "select",
              options: [
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" }
              ]
            },
            {
              group: "Category",
              type: "multiselect",
              options: [
                { value: "dev", label: "Dev" }
              ]
            }
          ];
        `,
      },
      app,
      null
    );

    expect(result).toEqual([
      { value: "draft", label: "Draft", group: "Status", type: "select" },
      {
        value: "published",
        label: "Published",
        group: "Status",
        type: "select",
      },
      { value: "dev", label: "Dev", group: "Category", type: "multiselect" },
    ]);
  });

  it("supports mixed grouped and flat JS source output", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `
          return [
            { value: "ungrouped", label: "Ungrouped" },
            {
              group: "Status",
              options: [
                { value: "draft", label: "Draft" }
              ]
            }
          ];
        `,
      },
      app,
      null
    );

    expect(result).toEqual([
      {
        value: "ungrouped",
        label: "Ungrouped",
        group: undefined,
        type: undefined,
      },
      { value: "draft", label: "Draft", group: "Status", type: undefined },
    ]);
  });

  it("filters by query source", async () => {
    const app = makeApp([
      { path: "Notes/A.md", tags: ["#article"], fm: {} },
      { path: "Notes/B.md", tags: ["#book"], fm: {} },
    ]);

    const result = await resolveSource({ query: "#article" }, app, null);
    expect(result.map((r) => r.value)).toEqual(["A"]);
  });

  it("returns empty array when source has no matching conditions", async () => {
    const app = makeApp([{ path: "Notes/A.md", tags: [], fm: {} }]);

    const result = await resolveSource({}, app, null);
    expect(result).toEqual([]);
  });

  it("returns empty array when JS source throws", async () => {
    const app = makeAppWithDataview([]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await resolveSource({ js: "throw new Error('bad')" }, app, null);
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("JS source with flat string array", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return ["a", "b", "c"];`,
      },
      app,
      null
    );

    expect(result).toEqual([
      { value: "a", label: "a", group: undefined, type: undefined },
      { value: "b", label: "b", group: undefined, type: undefined },
      { value: "c", label: "c", group: undefined, type: undefined },
    ]);
  });

  it("JS source returns empty for string result", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return "just a string";`,
      },
      app,
      null
    );

    expect(result).toEqual([]);
  });

  it("JS source handles Set iterable", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return new Set(["a", "b"]);`,
      },
      app,
      null
    );

    expect(result.map((r) => r.value).sort()).toEqual(["a", "b"]);
  });

  it("coerceToString handles number and boolean values", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ value: 42, label: true }];`,
      },
      app,
      null
    );

    expect(result).toEqual([{ value: "42", label: "true", group: undefined, type: undefined }]);
  });

  it("normalizeSelectionType handles unknown type strings", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ value: "a", type: "unknown" }];`,
      },
      app,
      null
    );

    expect(result[0]?.type).toBeUndefined();
  });

  it("optionFromUnknown handles object without value property", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ label: "OnlyLabel" }];`,
      },
      app,
      null
    );

    expect(result[0]?.value).toBe("");
    expect(result[0]?.label).toBe("OnlyLabel");
  });

  it("handles dataview page() throwing", async () => {
    const app = makeApp([]) as unknown as Record<string, unknown>;
    app.plugins = {
      plugins: {
        dataview: {
          api: {
            page: () => {
              throw new Error("dv fail");
            },
          },
        },
      },
    };

    const result = await resolveSource(
      { js: `return ["a"];` },
      app as unknown as App,
      makeTFile("Notes/A.md")
    );
    expect(result.map((r) => r.value)).toEqual(["a"]);
  });

  it("coerceToString handles null and undefined values", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ value: null, label: undefined }];`,
      },
      app,
      null
    );

    expect(result[0]?.value).toBe("");
    expect(result[0]?.label).toBe("");
  });

  it("coerceToString handles DataView Link object", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ value: { path: "People/Alice.md" } }];`,
      },
      app,
      null
    );

    expect(result[0]?.value).toBe("Alice");
  });

  it("coerceToString handles plain object without path", async () => {
    const app = makeAppWithDataview([]);

    const result = await resolveSource(
      {
        js: `return [{ value: { foo: "bar" } }];`,
      },
      app,
      null
    );

    expect(result[0]?.value).toBe("");
  });
});
