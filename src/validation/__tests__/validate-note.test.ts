import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSchema, ValidationResult } from "../../types";
import { validateNote } from "../validate-note";

function makeFile(path: string): TFile {
  const parts = path.split("/");
  const basenameWithExt = parts[parts.length - 1] ?? path;
  const basename = basenameWithExt.replace(/\.md$/, "");
  return { path, basename, extension: "md" } as TFile;
}

function makeSchema(overrides: Partial<ResolvedSchema> = {}): ResolvedSchema {
  return {
    manifestPath: "schemas/problems/manifest.md",
    name: "Problem",
    priority: 0,
    target: { query: "#problem" },
    fields: { color: { type: "text", fixed: "#d0b040" } },
    formatting: {},
    rules: [],
    inheritanceChain: ["schemas/problems/manifest.md"],
    ...overrides,
  };
}

interface FakeApp {
  app: App;
  renameFile: ReturnType<typeof vi.fn>;
  processFrontMatter: ReturnType<typeof vi.fn>;
  latest: Record<string, unknown>;
}

function makeApp(frontmatter: Record<string, unknown>): FakeApp {
  const latest = { ...frontmatter };
  const renameFile = vi.fn(async (file: TFile, targetPath: string) => {
    // Obsidian mutates the TFile in place on rename
    file.path = targetPath;
  });
  const processFrontMatter = vi.fn(
    async (_file: TFile, fn: (fm: Record<string, unknown>) => void) => {
      fn(latest);
    }
  );
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { renameFile, processFrontMatter },
  } as unknown as App;
  return { app, renameFile, processFrontMatter, latest };
}

function fixedColorEngine() {
  return {
    validate: vi.fn(async (_file: TFile, frontmatter: Record<string, unknown>) => {
      const results: ValidationResult[] = [];
      if (frontmatter["color"] !== "#d0b040") {
        frontmatter["color"] = "#d0b040";
        results.push({
          field: "color",
          severity: "info",
          message: '"color" was auto-corrected.',
          rule: "fixed",
          manifestPath: "schemas/problems/manifest.md",
          autoFixed: true,
        });
      }
      return results;
    }),
  };
}

describe("validateNote", () => {
  it("returns no schema when the note does not match", async () => {
    const file = makeFile("notes/a.md");
    const { app, processFrontMatter } = makeApp({});
    const resolver = { resolveForNote: vi.fn(() => null) };
    const engine = fixedColorEngine();

    const outcome = await validateNote({ app, resolver, engine }, file);

    expect(outcome).toEqual({ schema: null, results: [], moved: false });
    expect(engine.validate).not.toHaveBeenCalled();
    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it("writes only engine-changed keys onto the latest frontmatter", async () => {
    const file = makeFile("base/_problems/a.md");
    const { app, processFrontMatter, latest } = makeApp({ tags: ["problem"], color: "#000" });
    // Simulate a concurrent write that landed between cache read and auto-fix
    latest["title"] = "fresh";
    const resolver = { resolveForNote: vi.fn(() => makeSchema()) };
    const engine = fixedColorEngine();

    const outcome = await validateNote({ app, resolver, engine }, file);

    expect(outcome.moved).toBe(false);
    expect(outcome.results.map((r) => r.rule)).toEqual(["fixed"]);
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(latest).toEqual({ tags: ["problem"], color: "#d0b040", title: "fresh" });
  });

  it("keeps validating and auto-fixing after an enforce_folder move", async () => {
    // Regression: a note re-typed by another plugin lands in the wrong folder.
    // The move must not short-circuit validation — nothing re-triggers it after
    // a rename, so the note would otherwise stay un-fixed indefinitely.
    const file = makeFile("base/_meta-notes/a.md");
    const { app, renameFile, processFrontMatter, latest } = makeApp({
      tags: ["problem"],
      color: "#6fa8d6",
    });
    const resolver = {
      resolveForNote: vi.fn(() => makeSchema({ enforce_folder: "base/_problems" })),
    };
    const engine = fixedColorEngine();

    const outcome = await validateNote({ app, resolver, engine }, file);

    expect(renameFile).toHaveBeenCalledWith(file, "base/_problems/a.md");
    expect(outcome.moved).toBe(true);
    expect(engine.validate).toHaveBeenCalledTimes(1);
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(processFrontMatter.mock.calls[0]?.[0]).toBe(file);
    expect(latest["color"]).toBe("#d0b040");
    expect(outcome.results.some((r) => r.rule === "fixed")).toBe(true);
  });

  it("re-resolves the schema at the new location after a move", async () => {
    const file = makeFile("inbox/a.md");
    const { app, renameFile } = makeApp({ tags: ["problem"], color: "#000" });
    const before = makeSchema({ enforce_folder: "base/_problems" });
    const after = makeSchema({
      manifestPath: "schemas/problems-archive/manifest.md",
      target: { query: "base/_problems/" },
    });
    const resolver = {
      resolveForNote: vi.fn((f: TFile) => (f.path.startsWith("base/_problems/") ? after : before)),
    };
    const engine = fixedColorEngine();

    const outcome = await validateNote({ app, resolver, engine }, file);

    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(engine.validate.mock.calls[0]?.[2]).toBe(after);
    expect(outcome.schema).toBe(after);
  });

  it("reorders the latest frontmatter in place when only the order changed", async () => {
    const file = makeFile("base/_problems/a.md");
    const { app, processFrontMatter, latest } = makeApp({ color: "#d0b040", tags: ["problem"] });
    // A key added concurrently must survive and stay after the ordered keys
    latest["extra"] = 1;
    const resolver = {
      resolveForNote: vi.fn(() =>
        makeSchema({ formatting: { property_order: ["tags", "color"] } })
      ),
    };
    const engine = {
      validate: vi.fn(async () => [
        {
          field: "__order__",
          severity: "info",
          message: "Properties reordered.",
          rule: "property-order",
          manifestPath: "schemas/problems/manifest.md",
          autoFixed: true,
        } satisfies ValidationResult,
      ]),
    };

    await validateNote({ app, resolver, engine }, file);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(Object.keys(latest)).toEqual(["tags", "color", "extra"]);
    expect(latest).toEqual({ tags: ["problem"], color: "#d0b040", extra: 1 });
  });

  it("applies value changes and ordering in one write", async () => {
    const file = makeFile("base/_problems/a.md");
    const { app, processFrontMatter, latest } = makeApp({ color: "#000", tags: ["problem"] });
    const resolver = {
      resolveForNote: vi.fn(() =>
        makeSchema({ formatting: { property_order: ["tags", "color"] } })
      ),
    };
    const engine = {
      validate: vi.fn(async (_file: TFile, frontmatter: Record<string, unknown>) => {
        frontmatter["color"] = "#d0b040";
        return [
          {
            field: "color",
            severity: "info",
            message: '"color" was auto-corrected.',
            rule: "fixed",
            manifestPath: "schemas/problems/manifest.md",
            autoFixed: true,
          },
          {
            field: "__order__",
            severity: "info",
            message: "Properties reordered.",
            rule: "property-order",
            manifestPath: "schemas/problems/manifest.md",
            autoFixed: true,
          },
        ] satisfies ValidationResult[];
      }),
    };

    await validateNote({ app, resolver, engine }, file);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(Object.keys(latest)).toEqual(["tags", "color"]);
    expect(latest["color"]).toBe("#d0b040");
  });

  it("skips the write when an order change has no effective order to apply", async () => {
    const file = makeFile("base/_problems/a.md");
    const { app, processFrontMatter } = makeApp({ color: "#d0b040" });
    const resolver = { resolveForNote: vi.fn(() => makeSchema({ fields: {}, formatting: {} })) };
    const engine = {
      validate: vi.fn(async () => [
        {
          field: "__order__",
          severity: "info",
          message: "Properties reordered.",
          rule: "property-order",
          manifestPath: "schemas/problems/manifest.md",
          autoFixed: true,
        } satisfies ValidationResult,
      ]),
    };

    await validateNote({ app, resolver, engine }, file);

    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it("appends a warning for legacy enforce_folder: true", async () => {
    const file = makeFile("base/_problems/a.md");
    const { app, renameFile } = makeApp({ color: "#d0b040" });
    const resolver = { resolveForNote: vi.fn(() => makeSchema({ enforce_folder: true })) };
    const engine = fixedColorEngine();

    const outcome = await validateNote({ app, resolver, engine }, file);

    expect(renameFile).not.toHaveBeenCalled();
    expect(outcome.results).toEqual([
      expect.objectContaining({ rule: "enforce_folder", severity: "warning" }),
    ]);
  });
});

describe("validateNote write budget", () => {
  function rulesEngine() {
    return {
      validate: vi.fn(async (_file: TFile, frontmatter: Record<string, unknown>) => {
        frontmatter["end"] = "2026-09-18";
        const results: ValidationResult[] = [
          {
            field: "end",
            severity: "info",
            message: '"end" set by rule "x".',
            rule: "rules",
            manifestPath: "schemas/problems/manifest.md",
            autoFixed: true,
          },
        ];
        return results;
      }),
    };
  }

  it("writes when the budget allows and consumes it only for rule changes", async () => {
    const fake = makeApp({ tags: ["problem"], end: null });
    const allow = vi.fn(() => true);
    const resolver = { resolveForNote: () => makeSchema() };
    const { results } = await validateNote(
      { app: fake.app, resolver, engine: rulesEngine(), writeBudget: { allow } },
      makeFile("Notes/a.md")
    );
    expect(allow).toHaveBeenCalledWith("Notes/a.md");
    expect(fake.processFrontMatter).toHaveBeenCalledTimes(1);
    expect(fake.latest["end"]).toBe("2026-09-18");
    expect(results.find((r) => r.rule === "write-budget")).toBeUndefined();

    // Non-rule auto-fixes do not touch the budget
    allow.mockClear();
    const fake2 = makeApp({ tags: ["problem"], color: "wrong" });
    await validateNote(
      { app: fake2.app, resolver, engine: fixedColorEngine(), writeBudget: { allow } },
      makeFile("Notes/b.md")
    );
    expect(allow).not.toHaveBeenCalled();
    expect(fake2.processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it("skips the write and warns when the budget is exhausted", async () => {
    const fake = makeApp({ tags: ["problem"], end: null });
    const resolver = { resolveForNote: () => makeSchema() };
    const { results } = await validateNote(
      { app: fake.app, resolver, engine: rulesEngine(), writeBudget: { allow: () => false } },
      makeFile("Notes/a.md")
    );
    expect(fake.processFrontMatter).not.toHaveBeenCalled();
    expect(fake.latest["end"]).toBeNull();
    expect(results.find((r) => r.rule === "write-budget")).toMatchObject({
      severity: "warning",
      autoFixed: false,
    });
  });
});
