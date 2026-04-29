import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSchema, ValidationResult } from "../../types";
import { applyVaultAutoFixes } from "../batch-auto-fix";

function makeFile(path: string): TFile {
  const parts = path.split("/");
  const basenameWithExt = parts[parts.length - 1] ?? path;
  const basename = basenameWithExt.replace(/\.md$/, "");
  return {
    path,
    basename,
    extension: "md",
  } as TFile;
}

function makeApp(
  files: TFile[],
  frontmatterByPath: Map<string, Record<string, unknown>>,
  renameFile?: (file: TFile, targetPath: string) => Promise<void>
): App {
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path) ?? {},
      }),
    },
    fileManager: {
      renameFile:
        renameFile ??
        (async () => {
          return undefined;
        }),
    },
  } as unknown as App;
}

function makeSchema(overrides: Partial<ResolvedSchema> = {}): ResolvedSchema {
  return {
    manifestPath: "schemas/books/manifest.md",
    name: "Books",
    priority: 0,
    target: { query: "books/" },
    fields: {},
    formatting: {},
    inheritanceChain: ["schemas/books/manifest.md"],
    ...overrides,
  };
}

describe("applyVaultAutoFixes", () => {
  it("writes auto-fixed frontmatter for matching notes and skips schema files", async () => {
    const note = makeFile("books/clean-code.md");
    const other = makeFile("notes/random.md");
    const schemaFile = makeFile("schemas/books/manifest.md");
    const files = [note, other, schemaFile];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([
      [note.path, { title: "Clean Code", position: { start: 1 } }],
      [other.path, { title: "Random" }],
      [schemaFile.path, { name: "books" }],
    ]);

    const resolver = {
      resolveForNote: vi.fn((file: TFile) => {
        if (file.path === note.path) return makeSchema();
        return null;
      }),
    };
    const engine = {
      validate: vi.fn(async (_file: TFile, frontmatter: Record<string, unknown>) => {
        frontmatter["status"] = "reading";
        return [
          {
            field: "status",
            severity: "info",
            message: '"status" was auto-corrected.',
            rule: "default",
            manifestPath: "schemas/books/manifest.md",
            autoFixed: true,
          },
        ] satisfies ValidationResult[];
      }),
    };
    const writeFrontmatter = vi.fn(async () => undefined);

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter,
    });

    expect(summary).toEqual({
      total: 2,
      matched: 1,
      changed: 1,
      moved: 0,
      autoFixed: 1,
      errors: 0,
      warnings: 0,
      noSchema: 1,
      failed: 0,
    });
    expect(writeFrontmatter).toHaveBeenCalledTimes(1);
    expect(writeFrontmatter).toHaveBeenCalledWith(
      note,
      expect.objectContaining({ title: "Clean Code", status: "reading" })
    );
    expect((writeFrontmatter.mock.calls[0] as unknown[])[1]).not.toHaveProperty("position");
  });

  it("re-resolves the schema after moving a note and writes fixes to the new path", async () => {
    const note = makeFile("notes/source.md");
    const movedNote = makeFile("sources/source.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const renameFile = vi.fn(async (file: TFile, targetPath: string) => {
      files[0] = movedNote;
      frontmatterByPath.set(targetPath, frontmatterByPath.get(file.path) ?? {});
      frontmatterByPath.delete(file.path);
      file.path = targetPath;
      file.basename = movedNote.basename;
    });

    const resolver = {
      resolveForNote: vi.fn((file: TFile) => {
        if (file.path === "notes/source.md") {
          return makeSchema({ enforce_folder: "sources/" });
        }
        if (file.path === "sources/source.md") {
          return makeSchema({
            manifestPath: "schemas/sources/manifest.md",
            fields: { status: { type: "select", default: "ready" } },
          });
        }
        return null;
      }),
    };
    const engine = {
      validate: vi.fn(async (_file: TFile, frontmatter: Record<string, unknown>) => {
        frontmatter["status"] = "ready";
        return [
          {
            field: "status",
            severity: "info",
            message: '"status" was auto-corrected.',
            rule: "default",
            manifestPath: "schemas/sources/manifest.md",
            autoFixed: true,
          },
        ] satisfies ValidationResult[];
      }),
    };
    const writeFrontmatter = vi.fn(async () => undefined);
    const onFileProcessed = vi.fn();

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath, renameFile),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter,
      onFileProcessed,
    });

    expect(renameFile).toHaveBeenCalledWith(note, "sources/source.md");
    expect(resolver.resolveForNote).toHaveBeenCalledTimes(2);
    expect(writeFrontmatter).toHaveBeenCalledWith(
      movedNote,
      expect.objectContaining({ status: "ready" })
    );
    expect(onFileProcessed).toHaveBeenCalledWith({
      previousPath: "notes/source.md",
      filePath: "sources/source.md",
      status: "valid",
      autoFixed: 1,
      errors: 0,
      warnings: 0,
      moved: true,
    });
    expect(summary.moved).toBe(1);
    expect(summary.changed).toBe(1);
  });

  it("increments failed count when engine throws", async () => {
    const note = makeFile("books/bad.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    };
    const engine = {
      validate: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const writeFrontmatter = vi.fn(async () => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter,
    });

    expect(summary.failed).toBe(1);
    expect(summary.matched).toBe(1);
    expect(writeFrontmatter).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("reports warning status when validation produces warnings", async () => {
    const note = makeFile("books/note.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([
        {
          field: "x",
          severity: "warning",
          message: "warn",
          rule: "test",
          manifestPath: "schemas/books/manifest.md",
          autoFixed: false,
        },
      ] satisfies ValidationResult[]),
    };
    const onFileProcessed = vi.fn();

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
      onFileProcessed,
    });

    expect(summary.warnings).toBe(1);
    expect(summary.errors).toBe(0);
    expect(onFileProcessed).toHaveBeenCalledWith(expect.objectContaining({ status: "warning" }));
  });

  it("reports valid status when no issues and no auto-fixes", async () => {
    const note = makeFile("books/note.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([] satisfies ValidationResult[]),
    };
    const onFileProcessed = vi.fn();

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
      onFileProcessed,
    });

    expect(summary.changed).toBe(0);
    expect(summary.autoFixed).toBe(0);
    expect(onFileProcessed).toHaveBeenCalledWith(expect.objectContaining({ status: "valid" }));
  });

  it("skips move when note is already in correct folder", async () => {
    const note = makeFile("books/note.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);
    const renameFile = vi.fn(async () => undefined);

    const resolver = {
      resolveForNote: vi.fn(() => makeSchema({ enforce_folder: "books/" })),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([] satisfies ValidationResult[]),
    };

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath, renameFile),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
    });

    expect(renameFile).not.toHaveBeenCalled();
    expect(summary.moved).toBe(0);
  });

  it("handles renameFile without returning refreshed file", async () => {
    const note = makeFile("notes/source.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const app = makeApp(files, frontmatterByPath, async () => undefined);
    app.vault.getAbstractFileByPath = () => null;

    const resolver = {
      resolveForNote: vi.fn((file: TFile) => {
        if (file.path === "notes/source.md") {
          return makeSchema({ enforce_folder: "sources/" });
        }
        return null;
      }),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([] satisfies ValidationResult[]),
    };

    const summary = await applyVaultAutoFixes({
      app,
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
    });

    expect(summary.moved).toBe(1);
  });

  it("reports error status when validation produces errors", async () => {
    const note = makeFile("books/note.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([
        {
          field: "x",
          severity: "error",
          message: "err",
          rule: "test",
          manifestPath: "schemas/books/manifest.md",
          autoFixed: false,
        },
      ] satisfies ValidationResult[]),
    };
    const onFileProcessed = vi.fn();

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
      onFileProcessed,
    });

    expect(summary.errors).toBe(1);
    expect(onFileProcessed).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("falls back to original schema when re-resolve returns null after move", async () => {
    const note = makeFile("notes/source.md");
    const files = [note];
    const frontmatterByPath = new Map<string, Record<string, unknown>>([[note.path, {}]]);

    const renameFile = vi.fn(async (file: TFile, targetPath: string) => {
      file.path = targetPath;
      file.basename = "source";
    });

    const originalSchema = makeSchema({
      enforce_folder: "sources/",
      fields: { x: { type: "text" } },
    });
    const resolver = {
      resolveForNote: vi.fn((file: TFile) => {
        if (file.path === "notes/source.md") return originalSchema;
        return null;
      }),
    };
    const engine = {
      validate: vi.fn().mockResolvedValue([] satisfies ValidationResult[]),
    };

    const summary = await applyVaultAutoFixes({
      app: makeApp(files, frontmatterByPath, renameFile),
      schemasRoot: "schemas",
      resolver,
      engine,
      writeFrontmatter: vi.fn(async () => undefined),
    });

    expect(summary.moved).toBe(1);
    expect(renameFile).toHaveBeenCalled();
  });
});
