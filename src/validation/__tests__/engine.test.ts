import { describe, it, expect, vi } from "vitest";
import { ValidationEngine } from "../engine";
import type { App, TFile } from "obsidian";
import type { ResolvedSchema } from "../../types";

function makeApp(): App {
  return {
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {
      processFrontMatter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as App;
}

const SCHEMA: ResolvedSchema = {
  manifestPath: "schemas/book/manifest.md",
  name: "book",
  priority: 0,
  target: { folder: "Books/" },
  fields: {
    status: {
      type: "select",
      required: true,
      options: [{ value: "to-read" }, { value: "reading" }, { value: "done" }],
    },
    rating: { type: "number", min: 1, max: 5 },
    icon: { type: "text", fixed: "📚" },
  },
  formatting: {},
  inheritanceChain: ["schemas/book/manifest.md"],
};

describe("ValidationEngine", () => {
  it("auto-inserts null for required field that is absent (no error shown)", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    // Required field without default → auto-inserted as null (autoFixed), not an error
    const autoFixed = results.find((r) => r.autoFixed && r.field === "status");
    expect(autoFixed).toBeDefined();
    expect(frontmatter["status"]).toBeNull();
    // No "required" error
    const req = results.find((r) => r.rule === "required");
    expect(req).toBeUndefined();
  });

  it("returns error for value not in options", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "draft", rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const opt = results.find((r) => r.rule === "options");
    expect(opt?.field).toBe("status");
  });

  it("applies auto-fix for fixed field and marks autoFixed", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { status: "reading", rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    expect(frontmatter["icon"]).toBe("📚");

    const fixed = results.find((r) => r.autoFixed && r.field === "icon");
    expect(fixed).toBeDefined();
  });

  it("returns no errors for fully valid frontmatter", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "reading", rating: 4, icon: "📚" };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const errors = results.filter((r) => !r.autoFixed);
    expect(errors).toHaveLength(0);
  });
});
