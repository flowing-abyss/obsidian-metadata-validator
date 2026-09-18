import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { ManifestCache } from "../cache";

function makeApp(files: Record<string, string>): App {
  const app = (
    App as unknown as {
      createConfigured__: (opts: { files: Record<string, string> }) => App;
    }
  ).createConfigured__({ files });
  vi.spyOn(app.vault, "read").mockImplementation(async (f) => files[f.path] ?? "");
  return app;
}

describe("ManifestCache", () => {
  it("loads all manifest.md files under the schemas root", async () => {
    const app = makeApp({
      "schemas/base/manifest.md": "---\nname: base\n---",
      "schemas/book/manifest.md": "---\nname: book\nextends: schemas/base\n---",
      "schemas/book/template.md": "# Template — not a manifest",
      "Books/My Book.md": "---\ntitle: My Book\n---",
    });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const manifests = cache.getAll();
    expect(manifests).toHaveLength(2);
    expect(manifests.map((m) => m.path).sort()).toEqual([
      "schemas/base/manifest.md",
      "schemas/book/manifest.md",
    ]);
  });

  it("stores parsed data on each manifest", async () => {
    const app = makeApp({ "schemas/book/manifest.md": "---\nname: book\n---" });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const m = cache.getAll()[0];
    expect(m?.data.name).toBe("book");
    expect(m?.folderPath).toBe("schemas/book");
  });

  it("getByFolder returns the manifest for an exact folder path", async () => {
    const app = makeApp({ "schemas/book/manifest.md": "---\nname: book\n---" });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const m = cache.getByFolder("schemas/book");
    expect(m?.data.name).toBe("book");
    expect(cache.getByFolder("schemas/movie")).toBeUndefined();
  });

  it("getByPath returns undefined for unknown path", async () => {
    const app = makeApp({ "schemas/book/manifest.md": "---\nname: book\n---" });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    expect(cache.getByPath("schemas/unknown/manifest.md")).toBeUndefined();
  });

  it("refresh updates an existing manifest in the cache", async () => {
    const app = makeApp({
      "schemas/book/manifest.md": "---\nname: book\n---",
    });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    vi.spyOn(app.vault, "read").mockResolvedValue("---\nname: updated\n---");
    const file = {
      path: "schemas/book/manifest.md",
      basename: "manifest",
      extension: "md",
    } as unknown as import("obsidian").TFile;
    await cache.refresh(file);

    expect(cache.getByPath("schemas/book/manifest.md")?.data.name).toBe("updated");
  });

  it("refresh skips non-manifest files", async () => {
    const app = makeApp({
      "schemas/book/manifest.md": "---\nname: book\n---",
    });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const before = cache.getByPath("schemas/book/manifest.md")?.data.name;
    const file = {
      path: "schemas/book/note.md",
      basename: "note",
      extension: "md",
    } as unknown as import("obsidian").TFile;
    await cache.refresh(file);

    expect(cache.getByPath("schemas/book/manifest.md")?.data.name).toBe(before);
  });

  it("delete removes a manifest from the cache", async () => {
    const app = makeApp({
      "schemas/book/manifest.md": "---\nname: book\n---",
    });

    const cache = new ManifestCache(app, "schemas");
    await cache.load();
    expect(cache.getAll()).toHaveLength(1);

    cache.delete("schemas/book/manifest.md");
    expect(cache.getAll()).toHaveLength(0);
  });

  it("constructor normalizes schemasRoot with trailing slash", async () => {
    const app = makeApp({
      "schemas/book/manifest.md": "---\nname: book\n---",
    });

    const cache = new ManifestCache(app, "schemas/");
    await cache.load();

    expect(cache.getAll()).toHaveLength(1);
  });
});

describe("ManifestCache rules.md", () => {
  const RULES_ROOT =
    '---\nname: Root rules\nrules:\n  - when: "created="\n    then:\n      set:\n        created: "{{now}}"\n---';
  const RULES_PROJECTS =
    "---\nrules:\n  - then:\n      set:\n        a: 1\n  - then:\n      set:\n        b: 2\n---";

  it("loads rules.md files under the schemas root and ignores others", async () => {
    const app = makeApp({
      "schemas/rules.md": RULES_ROOT,
      "schemas/projects/rules.md": RULES_PROJECTS,
      "schemas/projects/manifest.md": "---\nname: project\n---",
      "notes/rules.md": "---\nrules: []\n---",
    });
    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    expect(cache.getAll().map((m) => m.path)).toEqual(["schemas/projects/manifest.md"]);
    const rules = cache.getRulesFiles();
    expect(rules.map((r) => r.path).sort()).toEqual([
      "schemas/projects/rules.md",
      "schemas/rules.md",
    ]);
    expect(rules.find((r) => r.path === "schemas/rules.md")).toMatchObject({
      folderPath: "schemas",
      name: "Root rules",
    });
    expect(rules.find((r) => r.path === "schemas/projects/rules.md")?.rules).toHaveLength(2);
  });

  it("getRulesFilesForFolder returns ancestors outermost first", async () => {
    const app = makeApp({
      "schemas/rules.md": RULES_ROOT,
      "schemas/projects/rules.md": RULES_PROJECTS,
      "schemas/other/rules.md": RULES_PROJECTS,
    });
    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    expect(cache.getRulesFilesForFolder("schemas/projects/single").map((r) => r.path)).toEqual([
      "schemas/rules.md",
      "schemas/projects/rules.md",
    ]);
    expect(cache.getRulesFilesForFolder("schemas/projects").map((r) => r.path)).toEqual([
      "schemas/rules.md",
      "schemas/projects/rules.md",
    ]);
    expect(cache.getRulesFilesForFolder("schemas/projectsx").map((r) => r.path)).toEqual([
      "schemas/rules.md",
    ]);
  });

  it("non-array rules yields an empty list", async () => {
    const app = makeApp({ "schemas/rules.md": "---\nrules: nope\n---" });
    const cache = new ManifestCache(app, "schemas");
    await cache.load();
    expect(cache.getRulesFiles()[0]?.rules).toEqual([]);
    expect(cache.getRulesFiles()[0]?.name).toBeUndefined();
  });

  it("refresh and delete handle rules files", async () => {
    const files: Record<string, string> = { "schemas/rules.md": "---\nrules: []\n---" };
    const app = makeApp(files);
    const cache = new ManifestCache(app, "schemas");
    await cache.load();
    expect(cache.getRulesFiles()[0]?.rules).toHaveLength(0);

    files["schemas/rules.md"] = RULES_ROOT;
    const file = app.vault.getMarkdownFiles().find((f) => f.path === "schemas/rules.md");
    expect(cache.isRulesFile(file!)).toBe(true);
    expect(cache.isManifestFile(file!)).toBe(false);
    await cache.refresh(file!);
    expect(cache.getRulesFiles()[0]?.rules).toHaveLength(1);

    cache.delete("schemas/rules.md");
    expect(cache.getRulesFiles()).toHaveLength(0);
  });

  it("refresh ignores files that are neither manifest nor rules", async () => {
    const app = makeApp({ "schemas/note.md": "---\nrules: []\n---" });
    const cache = new ManifestCache(app, "schemas");
    await cache.load();
    const file = app.vault.getMarkdownFiles()[0]!;
    await cache.refresh(file);
    expect(cache.getAll()).toHaveLength(0);
    expect(cache.getRulesFiles()).toHaveLength(0);
  });
});
