import { describe, it, expect } from "vitest";
import { resolveSource } from "../source-resolver";
import type { App, TFile } from "obsidian";

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
      { path: "People/Alice.md", tags: [], fm: { type: "person", active: "true" } },
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
});
