import { describe, it, expect, vi } from "vitest";
import { ManifestCache } from "../cache";
import { App } from "obsidian";

function makeApp(files: Record<string, string>): App {
  const app = App.createConfigured__({ files });
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
});
