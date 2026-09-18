import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSchema, ValidationResult } from "../../types";
import { persistEngineChanges } from "../persist";

const schema: ResolvedSchema = {
  manifestPath: "s/manifest.md",
  name: "s",
  priority: 0,
  target: {},
  fields: {},
  rules: [],
  parseErrors: [],
  formatting: {},
  inheritanceChain: ["s/manifest.md"],
};
const fixed: ValidationResult = {
  field: "tags",
  severity: "info",
  message: "fixed",
  rule: "fixed",
  manifestPath: "s/manifest.md",
  autoFixed: true,
};
const file = { path: "n.md", basename: "n", extension: "md" } as TFile;

function makeApp(latest: Record<string, unknown>) {
  const processFrontMatter = vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) =>
    fn(latest)
  );
  return { app: { fileManager: { processFrontMatter } } as unknown as App, processFrontMatter };
}

describe("persistEngineChanges", () => {
  it("does not write when a list changed only by reference", async () => {
    const { app, processFrontMatter } = makeApp({});
    const written = await persistEngineChanges({
      app,
      file,
      schema,
      results: [fixed],
      before: { tags: ["a"] },
      after: { tags: ["a"] },
    });
    expect(written).toBe(false);
    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it("writes value changes and marks the note as a self-write", async () => {
    const latest: Record<string, unknown> = { tags: ["a"], other: 1 };
    const { app } = makeApp(latest);
    const mark = vi.fn();
    const written = await persistEngineChanges({
      app,
      file,
      schema,
      results: [fixed],
      before: { tags: ["a"] },
      after: { tags: ["a", "b"] },
      selfWrites: { mark },
    });
    expect(written).toBe(true);
    expect(latest).toEqual({ tags: ["a", "b"], other: 1 });
    expect(mark).toHaveBeenCalledWith("n.md");
  });

  it("does nothing without auto-fixed results", async () => {
    const { app, processFrontMatter } = makeApp({});
    expect(
      await persistEngineChanges({ app, file, schema, results: [], before: {}, after: { x: 1 } })
    ).toBe(false);
    expect(processFrontMatter).not.toHaveBeenCalled();
  });
});
