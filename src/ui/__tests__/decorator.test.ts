import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSettings } from "../../settings";
import type { ResolvedSchema } from "../../types";
import type { SchemaResolver } from "../../schema/resolver";
import type { ValidationEngine } from "../../validation/engine";
import { PropertyDecorator } from "../decorator";

function makeFile(path: string): TFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? path;
  return {
    path,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
  } as TFile;
}

function makeSchema(manifestPath: string): ResolvedSchema {
  return {
    manifestPath,
    inheritanceChain: [manifestPath],
    name: manifestPath.split("/").at(-2) ?? "schema",
    priority: 0,
    target: {},
    fields: {
      tags: { type: "multiselect" },
    },
    formatting: {},
  };
}

function makeDecoratorContext() {
  let activeFile = makeFile("Notes/first.md");

  const frontmatterByPath = new Map<string, Record<string, unknown>>([
    [activeFile.path, { tags: ["first"] }],
    ["Notes/second.md", { tags: ["second"] }],
    ["Notes/no-schema.md", { tags: ["orphan"] }],
  ]);

  const schemaByPath = new Map<string, ResolvedSchema | null>([
    [activeFile.path, makeSchema("schemas/first/manifest.md")],
    ["Notes/second.md", makeSchema("schemas/second/manifest.md")],
    ["Notes/no-schema.md", null],
  ]);

  const app = {
    workspace: {
      getActiveFile: vi.fn(() => activeFile),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path) ?? {},
      })),
    },
  } as unknown as App;

  const resolver = {
    resolveForNote: vi.fn((file: TFile) => schemaByPath.get(file.path) ?? null),
  } as unknown as SchemaResolver;

  const engine = {
    validate: vi.fn().mockResolvedValue([]),
  } as unknown as ValidationEngine;

  const settings = {
    showInlineErrors: true,
  } as PluginSettings;

  const decorator = new PropertyDecorator(app, resolver, engine, settings);

  return {
    decorator,
    setActiveFile: (path: string) => {
      activeFile = makeFile(path);
    },
  };
}

function renderPropertyRow(): void {
  document.body.innerHTML = `
    <div class="metadata-property" data-property-key="tags">
      <div class="metadata-property-key">tags</div>
    </div>
  `;
}

describe("PropertyDecorator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("replaces picker button context when the active note changes but the row DOM is reused", async () => {
    const { decorator, setActiveFile } = makeDecoratorContext();
    renderPropertyRow();

    await decorator.decorateAll();

    const firstButton = document.querySelector<HTMLElement>("[data-mv-picker='true']");
    expect(firstButton).not.toBeNull();
    expect(firstButton?.getAttribute("data-mv-picker-context")).toContain("Notes/first.md");

    setActiveFile("Notes/second.md");
    await decorator.decorateAll();

    const secondButton = document.querySelector<HTMLElement>("[data-mv-picker='true']");
    expect(secondButton).not.toBeNull();
    expect(secondButton).not.toBe(firstButton);
    expect(secondButton?.getAttribute("data-mv-picker-context")).toContain("Notes/second.md");
    expect(secondButton?.getAttribute("data-mv-picker-context")).toContain(
      "schemas/second/manifest.md"
    );
  });

  it("clears stale picker icons when switching to a note without a matching schema", async () => {
    const { decorator, setActiveFile } = makeDecoratorContext();
    renderPropertyRow();

    await decorator.decorateAll();
    expect(document.querySelector("[data-mv-picker='true']")).not.toBeNull();
    expect(document.querySelector(".metadata-property")?.classList.contains("mv-has-picker")).toBe(
      true
    );

    setActiveFile("Notes/no-schema.md");
    await decorator.decorateAll();

    expect(document.querySelector("[data-mv-picker='true']")).toBeNull();
    expect(document.querySelector(".metadata-property")?.classList.contains("mv-has-picker")).toBe(
      false
    );
  });
});
