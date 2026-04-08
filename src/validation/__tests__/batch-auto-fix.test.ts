import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
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
    expect(writeFrontmatter.mock.calls[0]?.[1]).not.toHaveProperty("position");
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
});
