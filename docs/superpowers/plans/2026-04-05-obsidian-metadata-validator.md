# Obsidian Metadata Validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manifest-driven metadata validation plugin for Obsidian that enforces field schemas, auto-fixes deterministic issues, and injects a picker icon + validator tooltip into the native properties panel.

**Architecture:** Four independent layers built bottom-up: Manifest Parser → Schema Resolver → Validation Engine → UI Layer. Pure logic layers are unit-tested with Vitest; UI layer (DOM decoration, modals) is manually tested in Obsidian.

**Tech Stack:** TypeScript, esbuild (bundler), Vitest (unit tests), Obsidian Plugin API (`app.fileManager.processFrontMatter`, `vault`, `workspace`).

**Spec:** `docs/superpowers/specs/2026-04-05-obsidian-metadata-validator-design.md`

---

## File Map

```
src/
  main.ts                          # plugin lifecycle — wire everything together
  settings.ts                      # PluginSettings interface + defaults + SettingTab
  types.ts                         # all shared TypeScript interfaces

  manifest/
    parser.ts                      # parse manifest.md YAML frontmatter → ManifestData
    cache.ts                       # ManifestCache: load all manifests, watch for changes
    __tests__/
      parser.test.ts
      cache.test.ts

  schema/
    resolver.ts                    # build inheritance graph, match note → ResolvedSchema
    merger.ts                      # merge parent + child field definitions
    source-resolver.ts             # evaluate FieldSource → TFile[] or FieldOption[]
    __tests__/
      resolver.test.ts
      merger.test.ts
      source-resolver.test.ts

  validation/
    engine.ts                      # orchestrate: run all rules, collect ValidationResult[]
    auto-fix.ts                    # apply default/fixed/sort to frontmatter
    rules/
      required.ts
      options.ts
      link-source.ts
      link-exists.ts
      number-range.ts
      js-validator.ts
    __tests__/
      engine.test.ts
      auto-fix.test.ts
      rules/
        required.test.ts
        options.test.ts
        link-source.test.ts
        number-range.test.ts

  ui/
    css-injector.ts                # inject CSS to hide Obsidian's type icon + validator
    decorator.ts                   # MutationObserver: inject picker + validator icons
    picker-modal.ts                # field value picker modal
    validator-tooltip.ts           # small error popover
    context-menu-modal.ts          # full property editor from right-click
    sidebar-panel.ts               # per-note issues leaf view
    explorer-badges.ts             # colored dots in file explorer
    validation-report.ts           # global vault report modal
    schema-tree.ts                 # settings: schema inheritance tree view

src/__mocks__/
  obsidian.ts                      # Vitest mock for the obsidian module

vitest.config.ts
```

---

## Task 1: Project setup — rename plugin, add Vitest, mock obsidian

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/__mocks__/obsidian.ts`

- [ ] **Update manifest.json**

```json
{
  "id": "obsidian-metadata-validator",
  "name": "Metadata Validator",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "Manifest-driven metadata validation, auto-fix, and field picker for Obsidian.",
  "author": "",
  "isDesktopOnly": false
}
```

- [ ] **Add Vitest to package.json**

Run:
```bash
npm install --save-dev vitest @vitest/coverage-v8
```

Then add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    alias: {
      obsidian: new URL("./src/__mocks__/obsidian.ts", import.meta.url).pathname,
    },
  },
});
```

- [ ] **Create src/__mocks__/obsidian.ts**

```typescript
// Minimal mock of the obsidian module for unit tests.
// Add stubs here as tests require them.

export class TFile {
  path: string;
  basename: string;
  extension: string;
  constructor(path: string) {
    this.path = path;
    this.basename = path.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? path;
    this.extension = path.split(".").pop() ?? "";
  }
}

export class Plugin {
  app: App = new App();
  async loadData(): Promise<unknown> { return {}; }
  async saveData(_data: unknown): Promise<void> {}
  addCommand(_cmd: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  registerEvent(_event: unknown): void {}
  registerInterval(_id: number): void {}
}

export class App {
  vault: Vault = new Vault();
  workspace: Workspace = new Workspace();
  fileManager: FileManager = new FileManager();
  metadataCache: MetadataCache = new MetadataCache();
}

export class Vault {
  getMarkdownFiles(): TFile[] { return []; }
  on(_event: string, _cb: unknown): unknown { return {}; }
  read(_file: TFile): Promise<string> { return Promise.resolve(""); }
}

export class Workspace {
  on(_event: string, _cb: unknown): unknown { return {}; }
  getActiveFile(): TFile | null { return null; }
}

export class FileManager {
  processFrontMatter(_file: TFile, _fn: (fm: Record<string, unknown>) => void): Promise<void> {
    return Promise.resolve();
  }
}

export class MetadataCache {
  getFileCache(_file: TFile): { frontmatter?: Record<string, unknown> } | null { return null; }
  on(_event: string, _cb: unknown): unknown { return {}; }
}

export class Modal {
  contentEl: HTMLElement = document.createElement("div");
  open(): void {}
  close(): void {}
}

export class ItemView {
  contentEl: HTMLElement = document.createElement("div");
}

export class PluginSettingTab {
  containerEl: HTMLElement = document.createElement("div");
}

export class Setting {
  constructor(_container: HTMLElement) {}
  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  addText(_cb: unknown): this { return this; }
  addToggle(_cb: unknown): this { return this; }
  addSlider(_cb: unknown): this { return this; }
  addDropdown(_cb: unknown): this { return this; }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export class Notice {
  constructor(_msg: string) {}
}
```

- [ ] **Verify tests can run**

```bash
npm test
```

Expected: `No test files found` (no errors).

- [ ] **Commit**

```bash
git add manifest.json package.json package-lock.json vitest.config.ts src/__mocks__/obsidian.ts
git commit -m "chore: rename plugin, add Vitest + obsidian mock"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Create src/types.ts**

```typescript
// All shared interfaces for the plugin.
// Import from here everywhere — never define types inline in feature files.

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "list"
  | "date"
  | "link"
  | "multilink"
  | "boolean"
  | "url";

export interface FieldOption {
  value: string;
  label?: string;
}

export interface FieldSource {
  folder?: string;
  tag?: string;
  /** key=value pairs, all must match (AND) */
  property?: Record<string, string>;
  js?: string;
}

export interface ManifestField {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  /** Always overwrite with this value (auto-fix) */
  fixed?: unknown;
  validate_exists?: boolean;
  sort?: "alphabetical";
  min?: number;
  max?: number;
  format?: string;
  /** Static options list OR dynamic source */
  options?: FieldOption[] | { source: FieldSource };
  /** For link/multilink: filter which notes are valid */
  source?: FieldSource;
  validate?: { js: string };
}

export interface ManifestTarget {
  op?: "AND" | "OR";
  folder?: string;
  tag?: string;
  property?: Record<string, string>;
}

/** Raw parsed content of a manifest.md frontmatter */
export interface ManifestData {
  name?: string;
  description?: string;
  priority?: number;
  extends?: string;
  target?: ManifestTarget;
  fields?: Record<string, ManifestField>;
  formatting?: {
    property_order?: string[];
  };
}

/** manifest.md file with its vault path + parsed data */
export interface Manifest {
  path: string;         // vault path to the manifest.md file, e.g. "schemas/book/manifest.md"
  folderPath: string;   // e.g. "schemas/book"
  data: ManifestData;
}

/** Fully resolved schema after merging inheritance chain */
export interface ResolvedSchema {
  manifestPath: string;
  name: string;
  priority: number;
  target: ManifestTarget;
  fields: Record<string, ManifestField>;
  formatting: { property_order?: string[] };
  /** vault paths from root ancestor to this manifest */
  inheritanceChain: string[];
}

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  field: string;
  severity: ValidationSeverity;
  message: string;
  /** rule name, e.g. "required", "options", "link-exists" */
  rule: string;
  manifestPath: string;
  autoFixed: boolean;
}
```

- [ ] **Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

## Task 3: Manifest Parser

**Files:**
- Create: `src/manifest/parser.ts`
- Create: `src/manifest/__tests__/parser.test.ts`

- [ ] **Write the failing test first**

```typescript
// src/manifest/__tests__/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseManifest } from "../parser";

describe("parseManifest", () => {
  it("parses valid frontmatter into ManifestData", () => {
    const raw = `---
name: book
target:
  folder: "Books/"
  tag: "#book"
fields:
  status:
    type: select
    required: true
    default: "to-read"
    options:
      - value: "📖"
        label: "In progress"
      - value: "✅"
        label: "Done"
  rating:
    type: number
    min: 1
    max: 5
---
Some body text here that should be ignored.`;

    const result = parseManifest(raw);

    expect(result.name).toBe("book");
    expect(result.target?.folder).toBe("Books/");
    expect(result.target?.tag).toBe("#book");
    expect(result.fields?.status?.type).toBe("select");
    expect(result.fields?.status?.required).toBe(true);
    expect(result.fields?.status?.default).toBe("to-read");
    expect(Array.isArray(result.fields?.status?.options)).toBe(true);
    expect(result.fields?.rating?.min).toBe(1);
  });

  it("returns empty object for file with no frontmatter", () => {
    const result = parseManifest("Just a markdown file with no frontmatter.");
    expect(result).toEqual({});
  });

  it("returns empty object for file with empty frontmatter", () => {
    const result = parseManifest("---\n---\nBody text.");
    expect(result).toEqual({});
  });

  it("handles extends field", () => {
    const raw = `---
name: movie
extends: "schemas/resource"
fields:
  director:
    type: link
---`;
    const result = parseManifest(raw);
    expect(result.extends).toBe("schemas/resource");
    expect(result.fields?.director?.type).toBe("link");
  });

  it("handles js source in field", () => {
    const raw = `---
fields:
  author:
    type: link
    source:
      js: "return dv.pages()"
---`;
    const result = parseManifest(raw);
    expect(result.fields?.author?.source?.js).toBe("return dv.pages()");
  });
});
```

- [ ] **Run test to verify it fails**

```bash
npm test src/manifest/__tests__/parser.test.ts
```

Expected: FAIL with `Cannot find module '../parser'`

- [ ] **Implement src/manifest/parser.ts**

```typescript
import type { ManifestData } from "../types";

/**
 * Parse raw markdown file content into ManifestData.
 * Extracts YAML frontmatter only; ignores the file body.
 * Returns {} if no valid frontmatter is found.
 */
export function parseManifest(fileContent: string): ManifestData {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};

  const yaml = match[1].trim();
  if (!yaml) return {};

  return parseYaml(yaml) as ManifestData;
}

/**
 * Minimal YAML parser sufficient for manifest frontmatter.
 * Handles: strings, numbers, booleans, null, arrays, nested objects.
 * Does NOT handle: anchors, aliases, multi-document streams, tags.
 */
function parseYaml(yaml: string): unknown {
  // Use Obsidian's built-in parseYaml when available (runtime),
  // fall back to a minimal implementation for tests.
  if (typeof (globalThis as Record<string, unknown>).parseYaml === "function") {
    return (globalThis as Record<string, { parseYaml: (s: string) => unknown }>)
      .parseYaml(yaml);
  }
  return parseYamlMinimal(yaml);
}

function parseYamlMinimal(yaml: string): unknown {
  // Split into lines and parse as an indented structure.
  const lines = yaml.split(/\r?\n/);
  return parseObject(lines, 0, 0).value;
}

type ParseResult = { value: unknown; nextLine: number };

function parseObject(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) { i++; continue; }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) { i++; continue; }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) break;

    const key = line.slice(indent, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === "" || rest === "|" || rest === ">") {
      // Value is on next lines
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent) {
          if (nextLine.trim().startsWith("- ")) {
            const arrResult = parseArray(lines, i, nextIndent);
            obj[key] = arrResult.value;
            i = arrResult.nextLine;
          } else {
            const subResult = parseObject(lines, i, nextIndent);
            obj[key] = subResult.value;
            i = subResult.nextLine;
          }
        } else {
          obj[key] = null;
        }
      }
    } else if (rest.startsWith("- ")) {
      const arrResult = parseArray([rest.trim(), ...lines.slice(i + 1)], 0, 0);
      obj[key] = arrResult.value;
      i += arrResult.nextLine;
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: obj, nextLine: i };
}

function parseArray(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") { i++; continue; }
    const indent = getIndent(line);
    if (indent < baseIndent) break;

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) break;

    const itemContent = trimmed.slice(2).trim();
    if (itemContent === "" || itemContent === "") {
      // Multi-line array item (object)
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent) {
          const subResult = parseObject(lines, i, nextIndent);
          arr.push(subResult.value);
          i = subResult.nextLine;
        }
      }
    } else if (itemContent.includes(":")) {
      // Inline object in array item: `- value: "x"` → parse as object
      const subResult = parseObject([itemContent, ...lines.slice(i + 1)], 0, 0);
      const subVal = subResult.value as Record<string, unknown>;
      // Check if next lines continue this object at deeper indent
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent + 2) {
          const moreResult = parseObject(lines, i, nextIndent);
          arr.push({ ...subVal, ...(moreResult.value as Record<string, unknown>) });
          i = moreResult.nextLine;
        } else {
          arr.push(subVal);
        }
      } else {
        arr.push(subVal);
      }
    } else {
      arr.push(parseScalar(itemContent));
      i++;
    }
  }

  return { value: arr, nextLine: i };
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/manifest/__tests__/parser.test.ts
```

Expected: All 5 tests PASS.

Note: The minimal YAML parser handles the test cases. At runtime Obsidian provides `parseYaml` globally which handles edge cases. If tests reveal parsing issues with complex YAML, use the `js-yaml` package instead — add `npm install --save-dev js-yaml @types/js-yaml` and replace `parseYamlMinimal` with `load(yaml)` from `js-yaml`.

- [ ] **Commit**

```bash
git add src/manifest/parser.ts src/manifest/__tests__/parser.test.ts
git commit -m "feat: manifest parser — extract YAML frontmatter from manifest.md"
```

---

## Task 4: Manifest Cache + Watcher

**Files:**
- Create: `src/manifest/cache.ts`
- Create: `src/manifest/__tests__/cache.test.ts`

- [ ] **Write failing tests**

```typescript
// src/manifest/__tests__/cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManifestCache } from "../cache";
import type { App, TFile } from "obsidian";

function makeFile(path: string, content: string): TFile {
  const f = { path, basename: path.split("/").pop()?.replace(".md", "") ?? "" } as TFile;
  return f;
}

function makeApp(files: Array<{ path: string; content: string }>): App {
  const tfiles = files.map(f => makeFile(f.path, f.content));
  const contentMap = new Map(files.map(f => [f.path, f.content]));

  return {
    vault: {
      getMarkdownFiles: () => tfiles,
      read: (f: TFile) => Promise.resolve(contentMap.get(f.path) ?? ""),
      on: vi.fn().mockReturnValue({}),
    },
  } as unknown as App;
}

describe("ManifestCache", () => {
  it("loads all manifest.md files under the schemas root", async () => {
    const app = makeApp([
      { path: "schemas/base/manifest.md", content: "---\nname: base\n---" },
      { path: "schemas/book/manifest.md", content: "---\nname: book\nextends: schemas/base\n---" },
      { path: "schemas/book/template.md", content: "# Template — not a manifest" },
      { path: "Books/My Book.md", content: "---\ntitle: My Book\n---" },
    ]);

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const manifests = cache.getAll();
    expect(manifests).toHaveLength(2);
    expect(manifests.map(m => m.path).sort()).toEqual([
      "schemas/base/manifest.md",
      "schemas/book/manifest.md",
    ]);
  });

  it("stores parsed data on each manifest", async () => {
    const app = makeApp([
      { path: "schemas/book/manifest.md", content: "---\nname: book\n---" },
    ]);

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const m = cache.getAll()[0];
    expect(m?.data.name).toBe("book");
    expect(m?.folderPath).toBe("schemas/book");
  });

  it("getByFolder returns the manifest for an exact folder path", async () => {
    const app = makeApp([
      { path: "schemas/book/manifest.md", content: "---\nname: book\n---" },
    ]);

    const cache = new ManifestCache(app, "schemas");
    await cache.load();

    const m = cache.getByFolder("schemas/book");
    expect(m?.data.name).toBe("book");
    expect(cache.getByFolder("schemas/movie")).toBeUndefined();
  });
});
```

- [ ] **Run test to verify it fails**

```bash
npm test src/manifest/__tests__/cache.test.ts
```

Expected: FAIL with `Cannot find module '../cache'`

- [ ] **Implement src/manifest/cache.ts**

```typescript
import type { App, TFile } from "obsidian";
import { parseManifest } from "./parser";
import type { Manifest } from "../types";

export class ManifestCache {
  private manifests: Map<string, Manifest> = new Map();
  private readonly app: App;
  private readonly schemasRoot: string;

  constructor(app: App, schemasRoot: string) {
    this.app = app;
    this.schemasRoot = schemasRoot.replace(/\/+$/, "");
  }

  async load(): Promise<void> {
    this.manifests.clear();
    const files = this.app.vault.getMarkdownFiles();
    const manifestFiles = files.filter(f => this.isManifestFile(f));

    await Promise.all(
      manifestFiles.map(async (file) => {
        const content = await this.app.vault.read(file);
        const data = parseManifest(content);
        const folderPath = file.path.replace(/\/manifest\.md$/, "");
        this.manifests.set(file.path, { path: file.path, folderPath, data });
      })
    );
  }

  private isManifestFile(file: TFile): boolean {
    return (
      file.path.startsWith(this.schemasRoot + "/") &&
      file.basename === "manifest" &&
      file.extension === "md"
    );
  }

  getAll(): Manifest[] {
    return Array.from(this.manifests.values());
  }

  getByPath(manifestPath: string): Manifest | undefined {
    return this.manifests.get(manifestPath);
  }

  getByFolder(folderPath: string): Manifest | undefined {
    return this.manifests.get(folderPath + "/manifest.md");
  }

  /** Update or remove a single manifest after a vault change event. */
  async refresh(file: TFile): Promise<void> {
    if (!this.isManifestFile(file)) return;
    const content = await this.app.vault.read(file);
    const data = parseManifest(content);
    const folderPath = file.path.replace(/\/manifest\.md$/, "");
    this.manifests.set(file.path, { path: file.path, folderPath, data });
  }

  delete(filePath: string): void {
    this.manifests.delete(filePath);
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/manifest/__tests__/cache.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Commit**

```bash
git add src/manifest/cache.ts src/manifest/__tests__/cache.test.ts
git commit -m "feat: manifest cache — load and index all manifest.md files"
```

---

## Task 5: Schema Merger

**Files:**
- Create: `src/schema/merger.ts`
- Create: `src/schema/__tests__/merger.test.ts`

- [ ] **Write failing tests**

```typescript
// src/schema/__tests__/merger.test.ts
import { describe, it, expect } from "vitest";
import { mergeSchemas } from "../merger";
import type { ManifestData } from "../../types";

describe("mergeSchemas", () => {
  it("child fields override parent fields", () => {
    const parent: ManifestData = {
      fields: {
        status: { type: "select", required: true, options: [{ value: "a" }] },
        title: { type: "text" },
      },
    };
    const child: ManifestData = {
      fields: {
        status: { type: "select", options: [{ value: "x" }, { value: "y" }] },
      },
    };

    const merged = mergeSchemas(parent, child);

    // Child's status options override parent's
    expect(merged.fields?.status?.options).toEqual([{ value: "x" }, { value: "y" }]);
    // But required from parent is NOT inherited when child redefines the field
    expect(merged.fields?.status?.required).toBeUndefined();
    // title not in child → inherited from parent
    expect(merged.fields?.title?.type).toBe("text");
  });

  it("child formatting overrides parent formatting", () => {
    const parent: ManifestData = {
      formatting: { property_order: ["a", "b", "c"] },
    };
    const child: ManifestData = {
      formatting: { property_order: ["x", "y"] },
    };

    const merged = mergeSchemas(parent, child);
    expect(merged.formatting?.property_order).toEqual(["x", "y"]);
  });

  it("inherits formatting when child has none", () => {
    const parent: ManifestData = {
      formatting: { property_order: ["a", "b"] },
    };
    const child: ManifestData = { fields: { rating: { type: "number" } } };

    const merged = mergeSchemas(parent, child);
    expect(merged.formatting?.property_order).toEqual(["a", "b"]);
  });

  it("child target does not inherit from parent", () => {
    const parent: ManifestData = { target: { folder: "Books/" } };
    const child: ManifestData = { target: { tag: "#movie" } };

    const merged = mergeSchemas(parent, child);
    // Target is always the child's own target
    expect(merged.target?.tag).toBe("#movie");
    expect(merged.target?.folder).toBeUndefined();
  });

  it("handles empty parent gracefully", () => {
    const child: ManifestData = { fields: { x: { type: "text" } } };
    const merged = mergeSchemas({}, child);
    expect(merged.fields?.x?.type).toBe("text");
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/schema/__tests__/merger.test.ts
```

Expected: FAIL `Cannot find module '../merger'`

- [ ] **Implement src/schema/merger.ts**

```typescript
import type { ManifestData } from "../types";

/**
 * Merge parent and child ManifestData.
 * Rules:
 * - fields: child fields entirely replace same-named parent fields (no deep merge)
 * - fields: parent fields not in child are inherited as-is
 * - formatting: child overrides parent if present
 * - target: always the child's own (never inherited)
 * - name, description, priority, extends: always child's own
 */
export function mergeSchemas(parent: ManifestData, child: ManifestData): ManifestData {
  return {
    name: child.name ?? parent.name,
    description: child.description ?? parent.description,
    priority: child.priority ?? parent.priority,
    extends: child.extends,
    target: child.target,
    fields: {
      ...(parent.fields ?? {}),
      ...(child.fields ?? {}),
    },
    formatting: child.formatting ?? parent.formatting,
  };
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/schema/__tests__/merger.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Commit**

```bash
git add src/schema/merger.ts src/schema/__tests__/merger.test.ts
git commit -m "feat: schema merger — child fields override parent, non-overridden fields inherited"
```

---

## Task 6: Schema Resolver

**Files:**
- Create: `src/schema/resolver.ts`
- Create: `src/schema/__tests__/resolver.test.ts`

- [ ] **Write failing tests**

```typescript
// src/schema/__tests__/resolver.test.ts
import { describe, it, expect } from "vitest";
import { SchemaResolver } from "../resolver";
import { ManifestCache } from "../../manifest/cache";
import type { Manifest } from "../../types";
import type { App, TFile } from "obsidian";
import { vi } from "vitest";

function makeCache(manifests: Manifest[]): ManifestCache {
  const cache = new ManifestCache({} as App, "schemas");
  vi.spyOn(cache, "getAll").mockReturnValue(manifests);
  vi.spyOn(cache, "getByFolder").mockImplementation((folder: string) =>
    manifests.find(m => m.folderPath === folder)
  );
  return cache;
}

function makeFile(path: string, tags: string[] = [], frontmatter: Record<string, unknown> = {}): TFile & { tags: string[]; frontmatter: Record<string, unknown> } {
  return { path, basename: path.split("/").pop() ?? "", extension: "md", tags, frontmatter } as unknown as TFile & { tags: string[]; frontmatter: Record<string, unknown> };
}

describe("SchemaResolver", () => {
  it("matches note to schema by folder", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { folder: "Books/" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("book");
  });

  it("matches note to schema by tag", () => {
    const cache = makeCache([
      {
        path: "schemas/article/manifest.md",
        folderPath: "schemas/article",
        data: { name: "article", target: { tag: "#article" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Notes/Some Article.md", ["#article"]);
    const schema = resolver.resolveForNote(file, {});
    expect(schema?.name).toBe("article");
  });

  it("returns null when no manifest matches", () => {
    const cache = makeCache([
      {
        path: "schemas/book/manifest.md",
        folderPath: "schemas/book",
        data: { name: "book", target: { folder: "Books/" }, fields: {} },
      },
    ]);

    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Movies/Dune.md");
    const schema = resolver.resolveForNote(file, {});
    expect(schema).toBeNull();
  });

  it("resolves inheritance chain via folder nesting", () => {
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: {
        name: "base",
        target: {},
        fields: { created: { type: "date" } },
      },
    };
    const book: Manifest = {
      path: "schemas/base/book/manifest.md",
      folderPath: "schemas/base/book",
      data: {
        name: "book",
        target: { folder: "Books/" },
        fields: { rating: { type: "number" } },
      },
    };

    const cache = makeCache([base, book]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});

    expect(schema?.name).toBe("book");
    // Inherited from base
    expect(schema?.fields["created"]?.type).toBe("date");
    // Own field
    expect(schema?.fields["rating"]?.type).toBe("number");
    expect(schema?.inheritanceChain).toEqual([
      "schemas/base/manifest.md",
      "schemas/base/book/manifest.md",
    ]);
  });

  it("explicit extends overrides folder-nesting inheritance", () => {
    const resource: Manifest = {
      path: "schemas/resource/manifest.md",
      folderPath: "schemas/resource",
      data: { name: "resource", target: {}, fields: { url: { type: "url" } } },
    };
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: { name: "base", target: {}, fields: { created: { type: "date" } } },
    };
    // book is nested inside base/ but explicitly extends resource
    const book: Manifest = {
      path: "schemas/base/book/manifest.md",
      folderPath: "schemas/base/book",
      data: {
        name: "book",
        extends: "schemas/resource",
        target: { folder: "Books/" },
        fields: { rating: { type: "number" } },
      },
    };

    const cache = makeCache([base, resource, book]);
    const resolver = new SchemaResolver(cache);
    resolver.rebuild();

    const file = makeFile("Books/Atomic Habits.md");
    const schema = resolver.resolveForNote(file, {});

    expect(schema?.fields["url"]?.type).toBe("url");       // from resource
    expect(schema?.fields["created"]).toBeUndefined();      // base NOT in chain
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/schema/__tests__/resolver.test.ts
```

Expected: FAIL `Cannot find module '../resolver'`

- [ ] **Implement src/schema/resolver.ts**

```typescript
import type { TFile } from "obsidian";
import type { Manifest, ManifestData, ResolvedSchema } from "../types";
import type { ManifestCache } from "../manifest/cache";
import { mergeSchemas } from "./merger";

export class SchemaResolver {
  private resolved: Map<string, ResolvedSchema> = new Map();
  private readonly cache: ManifestCache;

  constructor(cache: ManifestCache) {
    this.cache = cache;
  }

  /**
   * Build the resolved schema map from the current cache.
   * Call after cache.load() and after any manifest changes.
   */
  rebuild(): void {
    this.resolved.clear();
    for (const manifest of this.cache.getAll()) {
      const schema = this.resolve(manifest, new Set());
      if (schema) this.resolved.set(manifest.path, schema);
    }
  }

  private resolve(manifest: Manifest, visiting: Set<string>): ResolvedSchema | null {
    if (visiting.has(manifest.path)) {
      console.warn(`[MetadataValidator] Circular inheritance detected at ${manifest.path}`);
      return null;
    }
    visiting.add(manifest.path);

    const parent = this.findParent(manifest);
    if (!parent) {
      // Root manifest — no inheritance
      return this.toResolved(manifest, manifest.data, [manifest.path]);
    }

    const parentSchema = this.resolve(parent, visiting);
    if (!parentSchema) return null;

    const mergedData = mergeSchemas(parent.data, manifest.data);
    const chain = [...parentSchema.inheritanceChain, manifest.path];
    return this.toResolved(manifest, mergedData, chain);
  }

  private findParent(manifest: Manifest): Manifest | null {
    // Explicit extends takes priority
    if (manifest.data.extends) {
      const explicitPath = manifest.data.extends.replace(/\/+$/, "");
      const found =
        this.cache.getByFolder(explicitPath) ??
        this.cache.getByFolder(explicitPath.replace(/\/manifest\.md$/, ""));
      return found ?? null;
    }

    // Folder-nesting: check if parent folder contains a manifest.md
    const parts = manifest.folderPath.split("/");
    if (parts.length <= 1) return null;
    const parentFolder = parts.slice(0, -1).join("/");
    return this.cache.getByFolder(parentFolder) ?? null;
  }

  private toResolved(
    manifest: Manifest,
    data: ManifestData,
    chain: string[]
  ): ResolvedSchema {
    return {
      manifestPath: manifest.path,
      name: data.name ?? manifest.folderPath.split("/").pop() ?? "unknown",
      priority: data.priority ?? 0,
      target: data.target ?? {},
      fields: data.fields ?? {},
      formatting: data.formatting ?? {},
      inheritanceChain: chain,
    };
  }

  /**
   * Find the best matching schema for a given note.
   * Returns null if no manifest targets this note.
   */
  resolveForNote(
    file: TFile,
    frontmatter: Record<string, unknown>
  ): ResolvedSchema | null {
    const fileTags: string[] = (file as unknown as { tags?: string[] }).tags ?? [];
    const matches: ResolvedSchema[] = [];

    for (const schema of this.resolved.values()) {
      if (this.matchesTarget(file, fileTags, frontmatter, schema)) {
        matches.push(schema);
      }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0] ?? null;

    // Multiple matches: highest priority wins; ties → most specific target wins
    matches.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return targetSpecificity(b.target) - targetSpecificity(a.target);
    });
    return matches[0] ?? null;
  }

  private matchesTarget(
    file: TFile,
    fileTags: string[],
    frontmatter: Record<string, unknown>,
    schema: ResolvedSchema
  ): boolean {
    const { target } = schema;
    if (!target) return false;

    const conditions: boolean[] = [];

    if (target.folder) {
      conditions.push(file.path.startsWith(target.folder));
    }
    if (target.tag) {
      conditions.push(fileTags.includes(target.tag));
    }
    if (target.property) {
      const allMatch = Object.entries(target.property).every(
        ([k, v]) => String(frontmatter[k] ?? "") === v
      );
      conditions.push(allMatch);
    }

    if (conditions.length === 0) return false;

    return target.op === "OR"
      ? conditions.some(Boolean)
      : conditions.every(Boolean);
  }
}

function targetSpecificity(target: ResolvedSchema["target"]): number {
  return (target.folder ? 1 : 0) + (target.tag ? 1 : 0) + (target.property ? 1 : 0);
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/schema/__tests__/resolver.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Commit**

```bash
git add src/schema/resolver.ts src/schema/__tests__/resolver.test.ts
git commit -m "feat: schema resolver — inheritance graph + note→schema matching"
```

---

## Task 7: Source Resolver

**Files:**
- Create: `src/schema/source-resolver.ts`
- Create: `src/schema/__tests__/source-resolver.test.ts`

- [ ] **Write failing tests**

```typescript
// src/schema/__tests__/source-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveSource } from "../source-resolver";
import type { App, TFile } from "obsidian";
import { TFile as MockTFile } from "obsidian";

function makeApp(files: Array<{ path: string; tags: string[]; fm: Record<string, unknown> }>): App {
  const tfiles = files.map(f => {
    const tf = new MockTFile(f.path);
    return tf;
  });

  return {
    vault: { getMarkdownFiles: () => tfiles },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const found = files.find(x => x.path === f.path);
        if (!found) return null;
        // Obsidian's CachedMetadata has both frontmatter and tags (as {tag: string}[])
        return {
          frontmatter: found.fm,
          tags: found.tags.map(tag => ({ tag, position: {} })),
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
    expect(result.map(r => r.value).sort()).toEqual(["Alice", "Bob"]);
  });

  it("filters by tag", async () => {
    const app = makeApp([
      { path: "Notes/A.md", tags: ["#person"], fm: {} },
      { path: "Notes/B.md", tags: ["#book"], fm: {} },
    ]);

    const result = await resolveSource({ tag: "#person" }, app, null);
    expect(result.map(r => r.value)).toEqual(["A"]);
  });

  it("filters by frontmatter property", async () => {
    const app = makeApp([
      { path: "People/Alice.md", tags: [], fm: { type: "person", active: "true" } },
      { path: "People/Bob.md", tags: [], fm: { type: "org" } },
    ]);

    const result = await resolveSource({ property: { type: "person" } }, app, null);
    expect(result.map(r => r.value)).toEqual(["Alice"]);
  });

  it("combines folder + property with AND", async () => {
    const app = makeApp([
      { path: "People/Alice.md", tags: [], fm: { type: "person" } },
      { path: "People/Corp.md", tags: [], fm: { type: "org" } },
      { path: "Books/Some.md", tags: [], fm: { type: "person" } },
    ]);

    const result = await resolveSource({ folder: "People/", property: { type: "person" } }, app, null);
    expect(result.map(r => r.value)).toEqual(["Alice"]);
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/schema/__tests__/source-resolver.test.ts
```

Expected: FAIL `Cannot find module '../source-resolver'`

- [ ] **Implement src/schema/source-resolver.ts**

```typescript
import type { App, TFile } from "obsidian";
import type { FieldOption, FieldSource } from "../types";

/**
 * Resolve a FieldSource into a list of FieldOptions.
 * For link/multilink fields: returns { value: basename, label: basename }.
 * For js sources: executes the code with context and returns the result.
 *
 * @param source - the source definition from the manifest field
 * @param app - Obsidian App instance
 * @param currentFile - the note being validated (for JS context as `current`)
 */
export async function resolveSource(
  source: FieldSource,
  app: App,
  currentFile: TFile | null
): Promise<FieldOption[]> {
  if (source.js) {
    return resolveJsSource(source.js, app, currentFile);
  }

  const files = app.vault.getMarkdownFiles();
  const filtered = files.filter(f => fileMatchesSource(f, source, app));
  return filtered.map(f => ({ value: f.basename, label: f.basename }));
}

function fileMatchesSource(file: TFile, source: FieldSource, app: App): boolean {
  const conditions: boolean[] = [];

  if (source.folder) {
    conditions.push(file.path.startsWith(source.folder));
  }
  if (source.tag) {
    const cache = app.metadataCache.getFileCache(file);
    const tags: string[] = (cache as unknown as { tags?: Array<{ tag: string }> })?.tags
      ?.map((t: { tag: string }) => t.tag) ?? [];
    // Also check frontmatter tags
    const fmTags = (cache?.frontmatter?.["tags"] as string[] | undefined) ?? [];
    conditions.push(tags.includes(source.tag) || fmTags.includes(source.tag));
  }
  if (source.property) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const allMatch = Object.entries(source.property).every(
      ([k, v]) => String(fm[k] ?? "") === v
    );
    conditions.push(allMatch);
  }

  if (conditions.length === 0) return false;
  return conditions.every(Boolean); // always AND within a source block
}

async function resolveJsSource(
  code: string,
  app: App,
  currentFile: TFile | null
): Promise<FieldOption[]> {
  const dv = (app as unknown as Record<string, unknown>)["plugins"]
    ?.["dataview"]?.["api"] ?? undefined;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("app", "dv", "current", code);
    const result: unknown = await fn(app, dv, currentFile);
    if (!Array.isArray(result)) return [];
    return result.map(item =>
      typeof item === "string"
        ? { value: item, label: item }
        : { value: String(item.value ?? ""), label: String(item.label ?? item.value ?? "") }
    );
  } catch (e) {
    console.error("[MetadataValidator] Error in JS source:", e);
    return [];
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/schema/__tests__/source-resolver.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Commit**

```bash
git add src/schema/source-resolver.ts src/schema/__tests__/source-resolver.test.ts
git commit -m "feat: source resolver — folder/tag/property/js field value sources"
```

---

## Task 8: Validation Rules

**Files:**
- Create: `src/validation/rules/required.ts`
- Create: `src/validation/rules/options.ts`
- Create: `src/validation/rules/link-source.ts`
- Create: `src/validation/rules/link-exists.ts`
- Create: `src/validation/rules/number-range.ts`
- Create: `src/validation/rules/js-validator.ts`
- Create: `src/validation/rules/__tests__/required.test.ts`
- Create: `src/validation/rules/__tests__/options.test.ts`
- Create: `src/validation/rules/__tests__/link-source.test.ts`
- Create: `src/validation/rules/__tests__/number-range.test.ts`

- [ ] **Write failing tests for all rules**

```typescript
// src/validation/rules/__tests__/required.test.ts
import { describe, it, expect } from "vitest";
import { checkRequired } from "../required";

describe("checkRequired", () => {
  it("returns null when field has a value", () => {
    expect(checkRequired("author", "Alice", "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when required field is undefined", () => {
    const result = checkRequired("author", undefined, "schemas/book/manifest.md");
    expect(result?.field).toBe("author");
    expect(result?.rule).toBe("required");
    expect(result?.severity).toBe("error");
  });

  it("returns error when required field is empty string", () => {
    const result = checkRequired("author", "", "schemas/book/manifest.md");
    expect(result).not.toBeNull();
  });

  it("returns error when required field is empty array", () => {
    const result = checkRequired("tags", [], "schemas/book/manifest.md");
    expect(result).not.toBeNull();
  });

  it("returns null when value is 0 (falsy but valid)", () => {
    expect(checkRequired("rating", 0, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns null when value is false (falsy but valid)", () => {
    expect(checkRequired("active", false, "schemas/book/manifest.md")).toBeNull();
  });
});
```

```typescript
// src/validation/rules/__tests__/options.test.ts
import { describe, it, expect } from "vitest";
import { checkOptions } from "../options";
import type { FieldOption } from "../../../types";

const OPTIONS: FieldOption[] = [
  { value: "to-read" },
  { value: "reading" },
  { value: "done" },
];

describe("checkOptions", () => {
  it("returns null when value is in options", () => {
    expect(checkOptions("status", "reading", OPTIONS, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when value is not in options", () => {
    const result = checkOptions("status", "draft", OPTIONS, "schemas/book/manifest.md");
    expect(result?.rule).toBe("options");
    expect(result?.severity).toBe("error");
    expect(result?.message).toContain("draft");
  });

  it("returns null when value is undefined (let required rule handle that)", () => {
    expect(checkOptions("status", undefined, OPTIONS, "schemas/book/manifest.md")).toBeNull();
  });

  it("validates each item in array for multiselect", () => {
    const result = checkOptions("tags", ["reading", "unknown"], OPTIONS, "schemas/book/manifest.md");
    expect(result?.message).toContain("unknown");
  });

  it("returns null when all array items are valid", () => {
    expect(checkOptions("tags", ["reading", "done"], OPTIONS, "schemas/book/manifest.md")).toBeNull();
  });
});
```

```typescript
// src/validation/rules/__tests__/link-source.test.ts
import { describe, it, expect } from "vitest";
import { checkLinkSource } from "../link-source";
import type { FieldOption } from "../../../types";

const ALLOWED: FieldOption[] = [
  { value: "Alice" },
  { value: "Bob" },
];

describe("checkLinkSource", () => {
  it("returns null when linked note is in allowed source", () => {
    expect(checkLinkSource("author", "Alice", ALLOWED, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when linked note is not in allowed source", () => {
    const result = checkLinkSource("author", "Charlie", ALLOWED, "schemas/book/manifest.md");
    expect(result?.rule).toBe("link-source");
    expect(result?.severity).toBe("error");
  });

  it("returns null when value is undefined", () => {
    expect(checkLinkSource("author", undefined, ALLOWED, "schemas/book/manifest.md")).toBeNull();
  });

  it("validates each item in multilink array", () => {
    const result = checkLinkSource("authors", ["Alice", "Nobody"], ALLOWED, "schemas/book/manifest.md");
    expect(result?.message).toContain("Nobody");
  });
});
```

```typescript
// src/validation/rules/__tests__/number-range.test.ts
import { describe, it, expect } from "vitest";
import { checkNumberRange } from "../number-range";

describe("checkNumberRange", () => {
  it("returns null when value is within range", () => {
    expect(checkNumberRange("rating", 3, 1, 5, "schemas/book/manifest.md")).toBeNull();
  });

  it("returns error when value is below min", () => {
    const result = checkNumberRange("rating", 0, 1, 5, "schemas/book/manifest.md");
    expect(result?.rule).toBe("number-range");
    expect(result?.message).toContain("1");
  });

  it("returns error when value is above max", () => {
    const result = checkNumberRange("rating", 6, 1, 5, "schemas/book/manifest.md");
    expect(result?.message).toContain("5");
  });

  it("returns null when value is undefined", () => {
    expect(checkNumberRange("rating", undefined, 1, 5, "schemas/book/manifest.md")).toBeNull();
  });

  it("handles min-only", () => {
    expect(checkNumberRange("score", 0, 0, undefined, "schemas/book/manifest.md")).toBeNull();
    expect(checkNumberRange("score", -1, 0, undefined, "schemas/book/manifest.md")).not.toBeNull();
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/validation/rules/__tests__/
```

Expected: All fail with `Cannot find module`.

- [ ] **Implement the rule files**

```typescript
// src/validation/rules/required.ts
import type { ValidationResult } from "../../types";

export function checkRequired(
  field: string,
  value: unknown,
  manifestPath: string
): ValidationResult | null {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  if (!isEmpty) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" is required but empty.`,
    rule: "required",
    manifestPath,
    autoFixed: false,
  };
}
```

```typescript
// src/validation/rules/options.ts
import type { FieldOption, ValidationResult } from "../../types";

export function checkOptions(
  field: string,
  value: unknown,
  options: FieldOption[],
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(options.map(o => o.value));
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter(v => !allowed.has(String(v)));

  if (invalid.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" contains invalid value(s): ${invalid.map(v => `"${v}"`).join(", ")}. Allowed: ${[...allowed].join(", ")}.`,
    rule: "options",
    manifestPath,
    autoFixed: false,
  };
}
```

```typescript
// src/validation/rules/link-source.ts
import type { FieldOption, ValidationResult } from "../../types";

export function checkLinkSource(
  field: string,
  value: unknown,
  allowedOptions: FieldOption[],
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(allowedOptions.map(o => o.value));
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter(v => !allowed.has(String(v)));

  if (invalid.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" links to note(s) not in allowed source: ${invalid.map(v => `"${v}"`).join(", ")}.`,
    rule: "link-source",
    manifestPath,
    autoFixed: false,
  };
}
```

```typescript
// src/validation/rules/link-exists.ts
import type { App, TFile } from "obsidian";
import type { ValidationResult } from "../../types";

export function checkLinkExists(
  field: string,
  value: unknown,
  app: App,
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const values = Array.isArray(value) ? value : [value];
  const missing: string[] = [];

  for (const v of values) {
    const name = String(v);
    const found = app.vault.getMarkdownFiles().some(
      (f: TFile) => f.basename === name || f.path === name
    );
    if (!found) missing.push(name);
  }

  if (missing.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" links to non-existent note(s): ${missing.map(v => `"${v}"`).join(", ")}.`,
    rule: "link-exists",
    manifestPath,
    autoFixed: false,
  };
}
```

```typescript
// src/validation/rules/number-range.ts
import type { ValidationResult } from "../../types";

export function checkNumberRange(
  field: string,
  value: unknown,
  min: number | undefined,
  max: number | undefined,
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const num = Number(value);
  if (isNaN(num)) return null;

  if (min !== undefined && num < min) {
    return {
      field, severity: "error",
      message: `"${field}" value ${num} is below minimum ${min}.`,
      rule: "number-range", manifestPath, autoFixed: false,
    };
  }
  if (max !== undefined && num > max) {
    return {
      field, severity: "error",
      message: `"${field}" value ${num} exceeds maximum ${max}.`,
      rule: "number-range", manifestPath, autoFixed: false,
    };
  }
  return null;
}
```

```typescript
// src/validation/rules/js-validator.ts
import type { App, TFile } from "obsidian";
import type { ValidationResult } from "../../types";

const JS_TIMEOUT_MS = 2000;

export async function runJsValidator(
  field: string,
  value: unknown,
  jsCode: string,
  app: App,
  currentFile: TFile,
  manifestPath: string
): Promise<ValidationResult | null> {
  const dv = (app as unknown as Record<string, unknown>)["plugins"]
    ?.["dataview"]?.["api"] ?? undefined;

  const timeoutPromise = new Promise<ValidationResult>(resolve =>
    setTimeout(() => resolve({
      field, severity: "error",
      message: `"${field}" JS validator timed out after ${JS_TIMEOUT_MS}ms.`,
      rule: "js-validator", manifestPath, autoFixed: false,
    }), JS_TIMEOUT_MS)
  );

  const runPromise = (async (): Promise<ValidationResult | null> => {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("app", "dv", "current", "value", jsCode);
      const result: unknown = await fn(app, dv, currentFile, value);
      if (result === true) return null;
      return {
        field, severity: "error",
        message: typeof result === "string"
          ? result
          : `"${field}" failed custom JS validation.`,
        rule: "js-validator", manifestPath, autoFixed: false,
      };
    } catch (e) {
      return {
        field, severity: "error",
        message: `"${field}" JS validator threw: ${String(e)}`,
        rule: "js-validator", manifestPath, autoFixed: false,
      };
    }
  })();

  return Promise.race([runPromise, timeoutPromise]);
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/validation/rules/__tests__/
```

Expected: All 20 rule tests PASS.

- [ ] **Commit**

```bash
git add src/validation/rules/
git commit -m "feat: validation rules — required, options, link-source, link-exists, number-range, js-validator"
```

---

## Task 9: Auto-fix

**Files:**
- Create: `src/validation/auto-fix.ts`
- Create: `src/validation/__tests__/auto-fix.test.ts`

- [ ] **Write failing tests**

```typescript
// src/validation/__tests__/auto-fix.test.ts
import { describe, it, expect } from "vitest";
import { applyAutoFix } from "../auto-fix";
import type { ManifestField } from "../../types";

describe("applyAutoFix", () => {
  it("inserts default value when field is empty", () => {
    const field: ManifestField = { type: "select", default: "to-read" };
    const fm: Record<string, unknown> = {};
    const changed = applyAutoFix("status", field, fm);
    expect(fm["status"]).toBe("to-read");
    expect(changed).toBe(true);
  });

  it("does not overwrite existing value with default", () => {
    const field: ManifestField = { type: "select", default: "to-read" };
    const fm: Record<string, unknown> = { status: "reading" };
    const changed = applyAutoFix("status", field, fm);
    expect(fm["status"]).toBe("reading");
    expect(changed).toBe(false);
  });

  it("always sets fixed value, even if field has a value", () => {
    const field: ManifestField = { type: "text", fixed: "📚" };
    const fm: Record<string, unknown> = { icon: "something" };
    const changed = applyAutoFix("icon", field, fm);
    expect(fm["icon"]).toBe("📚");
    expect(changed).toBe(true);
  });

  it("does not mark changed when fixed value already matches", () => {
    const field: ManifestField = { type: "text", fixed: "📚" };
    const fm: Record<string, unknown> = { icon: "📚" };
    const changed = applyAutoFix("icon", field, fm);
    expect(changed).toBe(false);
  });

  it("sorts multiselect alphabetically when sort: alphabetical", () => {
    const field: ManifestField = { type: "multiselect", sort: "alphabetical" };
    const fm: Record<string, unknown> = { tags: ["c", "a", "b"] };
    const changed = applyAutoFix("tags", field, fm);
    expect(fm["tags"]).toEqual(["a", "b", "c"]);
    expect(changed).toBe(true);
  });

  it("does not mark changed when multiselect already sorted", () => {
    const field: ManifestField = { type: "multiselect", sort: "alphabetical" };
    const fm: Record<string, unknown> = { tags: ["a", "b", "c"] };
    const changed = applyAutoFix("tags", field, fm);
    expect(changed).toBe(false);
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/validation/__tests__/auto-fix.test.ts
```

Expected: FAIL `Cannot find module '../auto-fix'`

- [ ] **Implement src/validation/auto-fix.ts**

```typescript
import type { ManifestField } from "../types";

/**
 * Apply deterministic auto-fixes for a single field.
 * Mutates the frontmatter object in place.
 * Returns true if a change was made (so the caller can write it back).
 */
export function applyAutoFix(
  fieldName: string,
  field: ManifestField,
  frontmatter: Record<string, unknown>
): boolean {
  let changed = false;
  const current = frontmatter[fieldName];

  // fixed: always overwrite
  if (field.fixed !== undefined) {
    if (current !== field.fixed) {
      frontmatter[fieldName] = field.fixed;
      changed = true;
    }
    return changed;
  }

  // default: insert only if empty
  if (field.default !== undefined) {
    const isEmpty =
      current === undefined ||
      current === null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (isEmpty) {
      frontmatter[fieldName] = field.default;
      changed = true;
    }
  }

  // sort: alphabetical
  if (field.sort === "alphabetical" && Array.isArray(frontmatter[fieldName])) {
    const arr = frontmatter[fieldName] as unknown[];
    const sorted = [...arr].sort((a, b) => String(a).localeCompare(String(b)));
    if (sorted.some((v, i) => v !== arr[i])) {
      frontmatter[fieldName] = sorted;
      changed = true;
    }
  }

  return changed;
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/validation/__tests__/auto-fix.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Commit**

```bash
git add src/validation/auto-fix.ts src/validation/__tests__/auto-fix.test.ts
git commit -m "feat: auto-fix — default values, fixed values, alphabetical sort"
```

---

## Task 10: Validation Engine

**Files:**
- Create: `src/validation/engine.ts`
- Create: `src/validation/__tests__/engine.test.ts`

- [ ] **Write failing tests**

```typescript
// src/validation/__tests__/engine.test.ts
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
  it("returns error for required field that is empty", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const req = results.find(r => r.rule === "required");
    expect(req?.field).toBe("status");
  });

  it("returns error for value not in options", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "draft", rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const opt = results.find(r => r.rule === "options");
    expect(opt?.field).toBe("status");
  });

  it("applies auto-fix for fixed field and marks autoFixed", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { status: "reading", rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    expect(frontmatter["icon"]).toBe("📚");

    const fixed = results.find(r => r.autoFixed && r.field === "icon");
    expect(fixed).toBeDefined();
  });

  it("returns no errors for fully valid frontmatter", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app);
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "reading", rating: 4, icon: "📚" };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const errors = results.filter(r => !r.autoFixed);
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Run to verify failure**

```bash
npm test src/validation/__tests__/engine.test.ts
```

Expected: FAIL `Cannot find module '../engine'`

- [ ] **Implement src/validation/engine.ts**

```typescript
import type { App, TFile } from "obsidian";
import type { FieldOption, ManifestField, ResolvedSchema, ValidationResult } from "../types";
import { applyAutoFix } from "./auto-fix";
import { checkRequired } from "./rules/required";
import { checkOptions } from "./rules/options";
import { checkLinkSource } from "./rules/link-source";
import { checkLinkExists } from "./rules/link-exists";
import { checkNumberRange } from "./rules/number-range";
import { runJsValidator } from "./rules/js-validator";
import { resolveSource } from "../schema/source-resolver";

export class ValidationEngine {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Validate a note's frontmatter against a resolved schema.
   * Applies auto-fixes in place on the frontmatter object.
   * Returns all ValidationResults including auto-fixed ones.
   */
  async validate(
    file: TFile,
    frontmatter: Record<string, unknown>,
    schema: ResolvedSchema
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const fieldResults = await this.validateField(
        fieldName,
        fieldDef,
        frontmatter,
        file,
        schema.manifestPath
      );
      results.push(...fieldResults);
    }

    // Enforce property_order auto-fix
    if (schema.formatting.property_order?.length) {
      this.applyPropertyOrder(frontmatter, schema.formatting.property_order);
    }

    return results;
  }

  private async validateField(
    fieldName: string,
    field: ManifestField,
    frontmatter: Record<string, unknown>,
    file: TFile,
    manifestPath: string
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Auto-fix first (default, fixed, sort)
    const wasFixed = applyAutoFix(fieldName, field, frontmatter);
    if (wasFixed) {
      results.push({
        field: fieldName,
        severity: "info",
        message: `"${fieldName}" was auto-corrected.`,
        rule: field.fixed !== undefined ? "fixed" : field.default !== undefined ? "default" : "sort",
        manifestPath,
        autoFixed: true,
      });
    }

    const value = frontmatter[fieldName];

    // required
    if (field.required) {
      const r = checkRequired(fieldName, value, manifestPath);
      if (r) results.push(r);
    }

    // options (static list)
    if (field.options && Array.isArray(field.options)) {
      const r = checkOptions(fieldName, value, field.options as FieldOption[], manifestPath);
      if (r) results.push(r);
    }

    // number range
    if (field.type === "number" && (field.min !== undefined || field.max !== undefined)) {
      const r = checkNumberRange(fieldName, value, field.min, field.max, manifestPath);
      if (r) results.push(r);
    }

    // link/multilink: source validation
    if ((field.type === "link" || field.type === "multilink") && field.source) {
      const allowedOptions = await resolveSource(field.source, this.app, file);
      const r = checkLinkSource(fieldName, value, allowedOptions, manifestPath);
      if (r) results.push(r);
    }

    // link exists
    if ((field.type === "link" || field.type === "multilink") && field.validate_exists) {
      const r = checkLinkExists(fieldName, value, this.app, manifestPath);
      if (r) results.push(r);
    }

    // custom JS validator
    if (field.validate?.js) {
      const r = await runJsValidator(fieldName, value, field.validate.js, this.app, file, manifestPath);
      if (r) results.push(r);
    }

    return results;
  }

  private applyPropertyOrder(
    frontmatter: Record<string, unknown>,
    order: string[]
  ): void {
    const keys = Object.keys(frontmatter);
    const orderedKeys = [
      ...order.filter(k => keys.includes(k)),
      ...keys.filter(k => !order.includes(k)),
    ];
    // Reorder in place by reassigning keys
    const copy = { ...frontmatter };
    for (const k of Object.keys(frontmatter)) delete frontmatter[k];
    for (const k of orderedKeys) frontmatter[k] = copy[k];
  }
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test src/validation/__tests__/engine.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Run all tests to confirm nothing is broken**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Commit**

```bash
git add src/validation/engine.ts src/validation/__tests__/engine.test.ts
git commit -m "feat: validation engine — orchestrates rules + auto-fix per schema"
```

---

## Task 11: Settings

**Files:**
- Modify: `src/settings.ts`

- [ ] **Replace src/settings.ts with full settings definition**

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import type MetadataValidatorPlugin from "./main";

export interface PluginSettings {
  schemasRoot: string;

  // Validation timing
  enableLiveValidation: boolean;
  enableOnSave: boolean;
  enableOnOpen: boolean;
  backgroundScanInterval: number; // minutes

  // UI visibility
  hideObsidianTypeIcon: boolean;
  hideObsidianValidator: boolean;
  showInlineErrors: boolean;
  showSidebarPanel: boolean;
  showFileExplorerBadges: boolean;

  // Property ordering
  globalPropertyOrder: string[]; // comma-separated list, stored as array
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemasRoot: "schemas",
  enableLiveValidation: true,
  enableOnSave: true,
  enableOnOpen: true,
  backgroundScanInterval: 5,
  hideObsidianTypeIcon: true,
  hideObsidianValidator: true,
  showInlineErrors: true,
  showSidebarPanel: true,
  showFileExplorerBadges: true,
  globalPropertyOrder: [],
};

export class MetadataValidatorSettingTab extends PluginSettingTab {
  plugin: MetadataValidatorPlugin;

  constructor(app: App, plugin: MetadataValidatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Metadata Validator" });

    // Schemas root
    new Setting(containerEl)
      .setName("Schemas folder")
      .setDesc("Vault path to the folder containing all manifest.md files.")
      .addText(text =>
        text
          .setPlaceholder("schemas")
          .setValue(this.plugin.settings.schemasRoot)
          .onChange(async value => {
            this.plugin.settings.schemasRoot = value.trim();
            await this.plugin.saveSettings();
            await this.plugin.reloadSchemas();
          })
      );

    containerEl.createEl("h3", { text: "Validation timing" });

    new Setting(containerEl)
      .setName("Live validation")
      .setDesc("Validate as you type (debounced 300ms).")
      .addToggle(t =>
        t.setValue(this.plugin.settings.enableLiveValidation).onChange(async v => {
          this.plugin.settings.enableLiveValidation = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Validate on save")
      .addToggle(t =>
        t.setValue(this.plugin.settings.enableOnSave).onChange(async v => {
          this.plugin.settings.enableOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Validate on open")
      .addToggle(t =>
        t.setValue(this.plugin.settings.enableOnOpen).onChange(async v => {
          this.plugin.settings.enableOnOpen = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Background scan interval (minutes)")
      .addSlider(s =>
        s
          .setLimits(1, 60, 1)
          .setValue(this.plugin.settings.backgroundScanInterval)
          .setDynamicTooltip()
          .onChange(async v => {
            this.plugin.settings.backgroundScanInterval = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "UI" });

    new Setting(containerEl)
      .setName("Hide Obsidian property type icon")
      .setDesc("Hides the ≡ 🔗 📅 icons that Obsidian shows to the left of each property name.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.hideObsidianTypeIcon).onChange(async v => {
          this.plugin.settings.hideObsidianTypeIcon = v;
          await this.plugin.saveSettings();
          this.plugin.cssInjector.update();
        })
      );

    new Setting(containerEl)
      .setName("Hide Obsidian native validator")
      .setDesc("Hides the ⚠ triangle Obsidian adds when a property value has a type mismatch.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.hideObsidianValidator).onChange(async v => {
          this.plugin.settings.hideObsidianValidator = v;
          await this.plugin.saveSettings();
          this.plugin.cssInjector.update();
        })
      );

    new Setting(containerEl)
      .setName("Show inline validation icons")
      .setDesc("Inject picker (left) and validator (right) icons into the properties panel.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showInlineErrors).onChange(async v => {
          this.plugin.settings.showInlineErrors = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show sidebar panel")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showSidebarPanel).onChange(async v => {
          this.plugin.settings.showSidebarPanel = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show file explorer badges")
      .setDesc("Color dots on file names: red = errors, yellow = warnings, green = valid.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showFileExplorerBadges).onChange(async v => {
          this.plugin.settings.showFileExplorerBadges = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Property order" });

    new Setting(containerEl)
      .setName("Global property order")
      .setDesc("Comma-separated list of property names. Applied as default order across all types. Individual manifests can override this.")
      .addText(text =>
        text
          .setPlaceholder("status, author, tags, rating")
          .setValue(this.plugin.settings.globalPropertyOrder.join(", "))
          .onChange(async value => {
            this.plugin.settings.globalPropertyOrder = value
              .split(",")
              .map(s => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );
  }
}
```

- [ ] **Commit**

```bash
git add src/settings.ts
git commit -m "feat: settings — full plugin settings with SettingTab"
```

---

## Task 12: CSS Injector

**Files:**
- Create: `src/ui/css-injector.ts`

No unit tests — pure DOM side effect. Tested manually in Obsidian.

- [ ] **Create src/ui/css-injector.ts**

```typescript
import type { PluginSettings } from "../settings";

const STYLE_ID = "metadata-validator-css";

/**
 * Injects/updates a <style> tag to hide Obsidian's native property UI elements.
 * Call update() whenever settings change.
 */
export class CssInjector {
  private readonly settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  update(): void {
    this.remove();
    const css = this.buildCss();
    if (!css) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  remove(): void {
    document.getElementById(STYLE_ID)?.remove();
  }

  private buildCss(): string {
    const rules: string[] = [];

    if (this.settings.hideObsidianTypeIcon) {
      // The type icon is the first .metadata-property-icon element
      rules.push(".metadata-property-icon { display: none !important; }");
    }

    if (this.settings.hideObsidianValidator) {
      // Obsidian's native invalid-value warning icon
      rules.push(".metadata-property[data-property-type='invalid'] .metadata-property-value::after { display: none !important; }");
      rules.push(".metadata-property-invalid-icon { display: none !important; }");
    }

    return rules.join("\n");
  }
}
```

- [ ] **Commit**

```bash
git add src/ui/css-injector.ts
git commit -m "feat: css injector — hide Obsidian native type icons and validator"
```

---

## Task 13: Property Decorator (MutationObserver)

**Files:**
- Create: `src/ui/decorator.ts`

Manual testing only — DOM decoration. Test by loading in Obsidian dev vault.

- [ ] **Create src/ui/decorator.ts**

```typescript
import type { App, TFile } from "obsidian";
import type { ResolvedSchema, ValidationResult } from "../types";
import type { SchemaResolver } from "../schema/resolver";
import type { ValidationEngine } from "../validation/engine";
import type { PluginSettings } from "../settings";

const PICKER_ATTR = "data-mv-picker";
const VALIDATOR_ATTR = "data-mv-validator";

export class PropertyDecorator {
  private observer: MutationObserver | null = null;
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private readonly settings: PluginSettings;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    app: App,
    resolver: SchemaResolver,
    engine: ValidationEngine,
    settings: PluginSettings
  ) {
    this.app = app;
    this.resolver = resolver;
    this.engine = engine;
    this.settings = settings;
  }

  /** Start observing the properties panel. */
  attach(): void {
    this.observer = new MutationObserver(() => this.onMutation());
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private onMutation(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.decorateAll(), 300);
  }

  /** Decorate all property rows visible in the active note. */
  async decorateAll(): Promise<void> {
    if (!this.settings.showInlineErrors) return;

    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const results = await this.engine.validate(file, frontmatter, schema);
    const resultMap = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = resultMap.get(r.field) ?? [];
      existing.push(r);
      resultMap.set(r.field, existing);
    }

    const rows = document.querySelectorAll<HTMLElement>(".metadata-property");
    for (const row of rows) {
      const key = row.getAttribute("data-property-key");
      if (!key) continue;
      const fieldDef = schema.fields[key];

      this.injectPickerIcon(row, key, schema, file, frontmatter);
      this.injectValidatorIcon(row, key, resultMap.get(key) ?? []);

      // Suppress injection for unmanaged fields
      if (!fieldDef) {
        row.querySelector(`[${PICKER_ATTR}]`)?.remove();
      }
    }
  }

  private injectPickerIcon(
    row: HTMLElement,
    fieldKey: string,
    schema: ResolvedSchema,
    file: TFile,
    frontmatter: Record<string, unknown>
  ): void {
    if (row.querySelector(`[${PICKER_ATTR}]`)) return; // already injected

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    const nameEl = row.querySelector<HTMLElement>(".metadata-property-key");
    if (!nameEl) return;

    const btn = document.createElement("button");
    btn.setAttribute(PICKER_ATTR, "true");
    btn.className = "mv-picker-btn clickable-icon";
    btn.setAttribute("aria-label", `Edit ${fieldKey}`);
    btn.textContent = "⊞";
    btn.style.cssText =
      "background:none;border:none;cursor:pointer;padding:0 4px;opacity:0.5;font-size:14px;";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Picker modal is imported dynamically to avoid circular deps
      import("./picker-modal").then(({ PickerModal }) => {
        new PickerModal(
          this.app,
          fieldKey,
          fieldDef,
          frontmatter[fieldKey],
          schema,
          file
        ).open();
      });
    });

    nameEl.after(btn);
  }

  private injectValidatorIcon(
    row: HTMLElement,
    _fieldKey: string,
    results: ValidationResult[]
  ): void {
    // Remove stale icon
    row.querySelector(`[${VALIDATOR_ATTR}]`)?.remove();

    const errors = results.filter(r => !r.autoFixed);
    if (errors.length === 0) return;

    const icon = document.createElement("span");
    icon.setAttribute(VALIDATOR_ATTR, "true");
    icon.className = "mv-validator-icon";
    icon.textContent = "⚠";
    icon.style.cssText =
      "color: var(--color-red, #f38ba8);cursor:pointer;font-size:13px;margin-left:4px;";

    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      import("./validator-tooltip").then(({ showValidatorTooltip }) => {
        showValidatorTooltip(icon, errors);
      });
    });

    row.appendChild(icon);
  }
}
```

- [ ] **Commit**

```bash
git add src/ui/decorator.ts
git commit -m "feat: property decorator — MutationObserver injects picker + validator icons"
```

---

## Task 14: Picker Modal

**Files:**
- Create: `src/ui/picker-modal.ts`

- [ ] **Create src/ui/picker-modal.ts**

```typescript
import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { FieldOption, ManifestField, ResolvedSchema } from "../types";
import { resolveSource } from "../schema/source-resolver";

export class PickerModal extends Modal {
  private readonly fieldKey: string;
  private readonly field: ManifestField;
  private readonly currentValue: unknown;
  private readonly schema: ResolvedSchema;
  private readonly file: TFile;
  private options: FieldOption[] = [];

  constructor(
    app: App,
    fieldKey: string,
    field: ManifestField,
    currentValue: unknown,
    schema: ResolvedSchema,
    file: TFile
  ) {
    super(app);
    this.fieldKey = fieldKey;
    this.field = field;
    this.currentValue = currentValue;
    this.schema = schema;
    this.file = file;
  }

  async onOpen(): Promise<void> {
    this.options = await this.loadOptions();
    this.render();
  }

  private async loadOptions(): Promise<FieldOption[]> {
    if (Array.isArray(this.field.options)) {
      return this.field.options as FieldOption[];
    }
    if (this.field.source) {
      return resolveSource(this.field.source, this.app, this.file);
    }
    if (
      this.field.options &&
      !Array.isArray(this.field.options) &&
      (this.field.options as { source: unknown }).source
    ) {
      return resolveSource(
        (this.field.options as { source: import("../types").FieldSource }).source,
        this.app,
        this.file
      );
    }
    return [];
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mv-picker-modal");

    // Header
    const header = contentEl.createDiv("mv-picker-header");
    header.createEl("strong", { text: this.fieldKey });
    header.createEl("span", {
      text: ` · ${this.field.type}${this.field.required ? " · required" : ""}`,
      cls: "mv-picker-meta",
    });

    // Search
    const search = contentEl.createEl("input", {
      type: "text",
      placeholder: "Search...",
      cls: "mv-picker-search",
    });
    search.style.cssText = "width:100%;margin:8px 0;padding:6px;";

    // Options list
    const listEl = contentEl.createDiv("mv-picker-list");
    this.renderOptions(listEl, this.options);

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      const filtered = this.options.filter(
        o => o.value.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q)
      );
      this.renderOptions(listEl, filtered);
    });

    // Footer
    const footer = contentEl.createDiv("mv-picker-footer");
    footer.style.cssText = "margin-top:12px;font-size:11px;color:var(--text-muted);";
    footer.createEl("span", { text: `Manifest: ${this.schema.manifestPath}` });
    if (this.schema.inheritanceChain.length > 1) {
      footer.createEl("br");
      footer.createEl("span", {
        text: `Inherits: ${this.schema.inheritanceChain.slice(0, -1).join(" → ")}`,
      });
    }
  }

  private renderOptions(listEl: HTMLElement, options: FieldOption[]): void {
    listEl.empty();

    if (options.length === 0) {
      listEl.createEl("p", {
        text: "No options available.",
        cls: "mv-picker-empty",
      });
      return;
    }

    for (const opt of options) {
      const item = listEl.createDiv("mv-picker-option");
      item.style.cssText =
        "padding:6px 10px;border-radius:4px;cursor:pointer;display:flex;justify-content:space-between;";

      const isSelected =
        Array.isArray(this.currentValue)
          ? this.currentValue.includes(opt.value)
          : this.currentValue === opt.value;

      if (isSelected) item.style.background = "var(--interactive-accent-hover)";

      const label = item.createEl("span", { text: opt.label ?? opt.value });
      if (opt.label && opt.label !== opt.value) {
        item.createEl("span", {
          text: opt.value,
          cls: "mv-picker-value-hint",
        }).style.cssText = "opacity:0.5;font-size:11px;";
      }

      item.addEventListener("mouseenter", () => {
        if (!isSelected) item.style.background = "var(--background-modifier-hover)";
      });
      item.addEventListener("mouseleave", () => {
        if (!isSelected) item.style.background = "";
      });

      item.addEventListener("click", () => {
        this.selectValue(opt.value);
        this.close();
      });
    }
  }

  private selectValue(value: string): void {
    const isMulti =
      this.field.type === "multiselect" ||
      this.field.type === "multilink" ||
      this.field.type === "list";

    this.app.fileManager.processFrontMatter(this.file, (fm) => {
      if (isMulti) {
        const current = Array.isArray(fm[this.fieldKey]) ? (fm[this.fieldKey] as string[]) : [];
        if (current.includes(value)) {
          fm[this.fieldKey] = current.filter(v => v !== value);
        } else {
          fm[this.fieldKey] = [...current, value];
        }
      } else {
        fm[this.fieldKey] = value;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Commit**

```bash
git add src/ui/picker-modal.ts
git commit -m "feat: picker modal — search + select field values, writes to frontmatter"
```

---

## Task 15: Validator Tooltip

**Files:**
- Create: `src/ui/validator-tooltip.ts`

- [ ] **Create src/ui/validator-tooltip.ts**

```typescript
import type { ValidationResult } from "../types";

const TOOLTIP_ID = "mv-validator-tooltip";

export function showValidatorTooltip(anchor: HTMLElement, results: ValidationResult[]): void {
  removeTooltip();

  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.style.cssText = `
    position: fixed;
    z-index: 9999;
    background: var(--background-primary);
    border: 1px solid var(--color-red, #f38ba8);
    border-radius: 6px;
    padding: 10px 14px;
    max-width: 320px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  const errors = results.filter(r => !r.autoFixed);

  for (const result of errors) {
    const row = tooltip.createDiv();
    row.style.cssText = "margin-bottom:6px;";

    const msg = row.createEl("div", { text: result.message });
    msg.style.color = result.severity === "error"
      ? "var(--color-red, #f38ba8)"
      : "var(--color-yellow, #f9e2af)";

    const meta = row.createEl("div");
    meta.style.cssText = "font-size:11px;opacity:0.6;margin-top:2px;";
    meta.textContent = `${result.rule} · ${result.manifestPath}`;

    // Link to manifest
    const link = row.createEl("a", { text: "Open manifest →" });
    link.style.cssText = "font-size:11px;color:var(--link-color);cursor:pointer;display:block;margin-top:2px;";
    link.addEventListener("click", () => {
      removeTooltip();
      (window as unknown as { app: { workspace: { openLinkText: (p: string, s: string) => void } } })
        .app.workspace.openLinkText(result.manifestPath, "");
    });
  }

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + 4}px`;
  tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;

  document.body.appendChild(tooltip);

  // Close on outside click
  const close = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node)) {
      removeTooltip();
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

function removeTooltip(): void {
  document.getElementById(TOOLTIP_ID)?.remove();
}
```

- [ ] **Commit**

```bash
git add src/ui/validator-tooltip.ts
git commit -m "feat: validator tooltip — inline error popover with manifest link"
```

---

## Task 16: Context Menu Modal

**Files:**
- Create: `src/ui/context-menu-modal.ts`

- [ ] **Create src/ui/context-menu-modal.ts**

```typescript
import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { ResolvedSchema, ValidationResult } from "../types";
import { ValidationEngine } from "../validation/engine";
import { PickerModal } from "./picker-modal";

export class ContextMenuModal extends Modal {
  private readonly file: TFile;
  private readonly schema: ResolvedSchema;
  private readonly engine: ValidationEngine;

  constructor(app: App, file: TFile, schema: ResolvedSchema) {
    super(app);
    this.file = file;
    this.schema = schema;
    this.engine = new ValidationEngine(app);
  }

  async onOpen(): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    const results = await this.engine.validate(this.file, frontmatter, this.schema);

    const resultMap = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = resultMap.get(r.field) ?? [];
      existing.push(r);
      resultMap.set(r.field, existing);
    }

    this.render(frontmatter, resultMap);
  }

  private render(
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Edit properties — ${this.file.basename}` });

    for (const [fieldKey, fieldDef] of Object.entries(this.schema.fields)) {
      const row = contentEl.createDiv("mv-context-row");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--background-modifier-border);";

      // Field name
      const nameEl = row.createEl("span", { text: fieldKey });
      nameEl.style.cssText = "min-width:120px;color:var(--text-normal);";

      // Current value
      const val = frontmatter[fieldKey];
      const valEl = row.createEl("span", {
        text: val !== undefined ? String(Array.isArray(val) ? val.join(", ") : val) : "—",
        cls: "mv-context-value",
      });
      valEl.style.cssText = "flex:1;margin:0 8px;opacity:0.8;font-size:12px;";

      // Errors
      const errors = (resultMap.get(fieldKey) ?? []).filter(r => !r.autoFixed);
      if (errors.length > 0) {
        const errIcon = row.createEl("span", { text: "⚠" });
        errIcon.style.color = "var(--color-red, #f38ba8)";
        errIcon.title = errors.map(e => e.message).join("\n");
      }

      // Edit button
      const editBtn = row.createEl("button", { text: "Edit" });
      editBtn.style.cssText = "margin-left:8px;font-size:12px;";
      editBtn.addEventListener("click", () => {
        this.close();
        new PickerModal(
          this.app,
          fieldKey,
          fieldDef,
          frontmatter[fieldKey],
          this.schema,
          this.file
        ).open();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Commit**

```bash
git add src/ui/context-menu-modal.ts
git commit -m "feat: context menu modal — full property editor for a note"
```

---

## Task 17: Sidebar Panel + File Explorer Badges

**Files:**
- Create: `src/ui/sidebar-panel.ts`
- Create: `src/ui/explorer-badges.ts`

- [ ] **Create src/ui/sidebar-panel.ts**

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ValidationResult } from "../types";

export const SIDEBAR_PANEL_TYPE = "mv-sidebar-panel";

export class SidebarPanel extends ItemView {
  private results: ValidationResult[] = [];
  private fileName = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return SIDEBAR_PANEL_TYPE; }
  getDisplayText(): string { return "Metadata Validator"; }
  getIcon(): string { return "shield-check"; }

  async onOpen(): Promise<void> {
    this.render();
  }

  update(fileName: string, results: ValidationResult[]): void {
    this.fileName = fileName;
    this.results = results;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h4", { text: this.fileName || "No file open" });

    const errors = this.results.filter(r => !r.autoFixed && r.severity === "error");
    const warnings = this.results.filter(r => !r.autoFixed && r.severity === "warning");
    const autoFixed = this.results.filter(r => r.autoFixed);

    if (this.results.length === 0) {
      contentEl.createEl("p", { text: "✓ All properties valid." });
      return;
    }

    for (const r of [...errors, ...warnings]) {
      const row = contentEl.createDiv("mv-sidebar-row");
      row.style.cssText = "padding:4px 0;border-bottom:1px solid var(--background-modifier-border);";
      row.createEl("span", {
        text: r.severity === "error" ? "⚠ " : "ℹ ",
        cls: r.severity === "error" ? "mv-error" : "mv-warning",
      });
      row.createEl("strong", { text: r.field + ": " });
      row.createEl("span", { text: r.message });
    }

    if (autoFixed.length > 0) {
      const af = contentEl.createDiv();
      af.style.cssText = "margin-top:8px;font-size:11px;opacity:0.6;";
      af.textContent = `⚙ ${autoFixed.length} auto-fixed`;
    }

    const summary = contentEl.createDiv();
    summary.style.cssText = "margin-top:8px;font-size:11px;opacity:0.5;";
    summary.textContent = `${errors.length} error(s) · ${warnings.length} warning(s)`;
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
```

- [ ] **Create src/ui/explorer-badges.ts**

```typescript
import type { App, TFile } from "obsidian";

const BADGE_CLASS = "mv-explorer-badge";

type BadgeStatus = "error" | "warning" | "valid" | "none";

export class ExplorerBadges {
  private readonly app: App;
  private readonly badgeMap: Map<string, BadgeStatus> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  setStatus(filePath: string, status: BadgeStatus): void {
    this.badgeMap.set(filePath, status);
  }

  clearAll(): void {
    this.badgeMap.clear();
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
  }

  render(): void {
    // Remove old badges
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());

    const fileItems = document.querySelectorAll<HTMLElement>(".nav-file-title");
    for (const item of fileItems) {
      const filePath = item.closest<HTMLElement>(".nav-file")
        ?.getAttribute("data-path");
      if (!filePath) continue;

      const status = this.badgeMap.get(filePath) ?? "none";
      if (status === "none") continue;

      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.style.cssText =
        "width:6px;height:6px;border-radius:50%;display:inline-block;margin-left:4px;vertical-align:middle;";

      switch (status) {
        case "error":   badge.style.background = "var(--color-red, #f38ba8)"; break;
        case "warning": badge.style.background = "var(--color-yellow, #f9e2af)"; break;
        case "valid":   badge.style.background = "var(--color-green, #a6e3a1)"; break;
      }

      item.appendChild(badge);
    }
  }
}
```

- [ ] **Commit**

```bash
git add src/ui/sidebar-panel.ts src/ui/explorer-badges.ts
git commit -m "feat: sidebar panel + file explorer badges"
```

---

## Task 18: main.ts — Wire everything together

**Files:**
- Modify: `src/main.ts`

- [ ] **Replace src/main.ts**

```typescript
import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MetadataValidatorSettingTab, PluginSettings } from "./settings";
import type { ValidationResult } from "./types";
import { ManifestCache } from "./manifest/cache";
import { SchemaResolver } from "./schema/resolver";
import { ValidationEngine } from "./validation/engine";
import { CssInjector } from "./ui/css-injector";
import { PropertyDecorator } from "./ui/decorator";
import { ContextMenuModal } from "./ui/context-menu-modal";
import { SidebarPanel, SIDEBAR_PANEL_TYPE } from "./ui/sidebar-panel";
import { ExplorerBadges } from "./ui/explorer-badges";

export default class MetadataValidatorPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  private cache!: ManifestCache;
  private resolver!: SchemaResolver;
  private engine!: ValidationEngine;
  cssInjector!: CssInjector;
  private decorator!: PropertyDecorator;
  private badges!: ExplorerBadges;
  private sidebarPanel: SidebarPanel | null = null;
  private backgroundScanTimer: ReturnType<typeof setInterval> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize layers
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    this.resolver = new SchemaResolver(this.cache);
    this.engine = new ValidationEngine(this.app);
    this.cssInjector = new CssInjector(this.settings);
    this.decorator = new PropertyDecorator(this.app, this.resolver, this.engine, this.settings);
    this.badges = new ExplorerBadges(this.app);

    // Load schemas
    await this.cache.load();
    this.resolver.rebuild();

    // Apply CSS overrides
    this.cssInjector.update();

    // Start DOM decoration
    this.decorator.attach();

    // Register settings tab
    this.addSettingTab(new MetadataValidatorSettingTab(this.app, this));

    // Register sidebar panel
    this.registerView(SIDEBAR_PANEL_TYPE, leaf => new SidebarPanel(leaf));

    // Watch for manifest changes
    this.registerEvent(
      this.app.vault.on("modify", async (file: TFile) => {
        if (file.basename === "manifest" && file.extension === "md") {
          await this.cache.refresh(file);
          this.resolver.rebuild();
        }
        if (this.settings.enableOnSave) {
          await this.validateAndUpdate(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TFile) => {
        if (file.basename === "manifest" && file.extension === "md") {
          this.cache.delete(file.path);
          this.resolver.rebuild();
        }
      })
    );

    // Validate on file open
    this.registerEvent(
      this.app.workspace.on("file-open", async (file: TFile | null) => {
        if (!file) return;
        if (this.settings.enableOnOpen) {
          await this.validateAndUpdate(file);
        }
      })
    );

    // Context menu: "Edit properties"
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file: TFile) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const schema = this.resolver.resolveForNote(file, fm ?? {});
        if (!schema) return;

        menu.addItem(item =>
          item
            .setTitle("Edit properties")
            .setIcon("pencil")
            .onClick(() => new ContextMenuModal(this.app, file, schema).open())
        );
      })
    );

    // Background scan
    this.startBackgroundScan();

    // Commands
    this.addCommand({
      id: "validate-current-note",
      name: "Validate current note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) await this.validateAndUpdate(file);
      },
    });

    this.addCommand({
      id: "open-sidebar-panel",
      name: "Open validation panel",
      callback: () => this.activateSidebarPanel(),
    });
  }

  onunload(): void {
    this.decorator.detach();
    this.cssInjector.remove();
    this.badges.clearAll();
    if (this.backgroundScanTimer) clearInterval(this.backgroundScanTimer);
  }

  async reloadSchemas(): Promise<void> {
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    await this.cache.load();
    this.resolver.rebuild();
  }

  private async validateAndUpdate(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);

    if (!schema) {
      this.badges.setStatus(file.path, "none");
      this.updateSidebarPanel(file.basename, []);
      return;
    }

    const results = await this.engine.validate(file, frontmatter, schema);

    // Write auto-fixes to disk
    const hasAutoFix = results.some(r => r.autoFixed);
    if (hasAutoFix) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.assign(fm, frontmatter);
      });
    }

    // Update badges
    const errors = results.filter(r => !r.autoFixed && r.severity === "error");
    const warnings = results.filter(r => !r.autoFixed && r.severity === "warning");
    this.badges.setStatus(
      file.path,
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid"
    );
    if (this.settings.showFileExplorerBadges) this.badges.render();

    this.updateSidebarPanel(file.basename, results);
  }

  private updateSidebarPanel(fileName: string, results: ValidationResult[]): void {
    if (!this.sidebarPanel) return;
    this.sidebarPanel.update(fileName, results);
  }

  private async activateSidebarPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIDEBAR_PANEL_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0] as WorkspaceLeaf);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: SIDEBAR_PANEL_TYPE });
    this.app.workspace.revealLeaf(leaf);
  }

  private startBackgroundScan(): void {
    if (this.backgroundScanTimer) clearInterval(this.backgroundScanTimer);
    const intervalMs = this.settings.backgroundScanInterval * 60 * 1000;
    this.backgroundScanTimer = this.registerInterval(
      window.setInterval(async () => {
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
          await this.validateAndUpdate(file);
        }
      }, intervalMs)
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Build the plugin**

```bash
npm run build
```

Expected: `main.js` created at project root with no TypeScript errors.

- [ ] **Commit**

```bash
git add src/main.ts
git commit -m "feat: wire all layers in main.ts — plugin is functional"
```

---

## Task 19: Manual testing in Obsidian

No code changes — install and verify.

- [ ] **Copy plugin to your vault**

```bash
# Replace YOUR_VAULT with your actual vault path
cp main.js manifest.json /path/to/YOUR_VAULT/.obsidian/plugins/obsidian-metadata-validator/
```

- [ ] **Enable plugin in Obsidian**

Go to **Settings → Community plugins → Installed plugins** → enable **Metadata Validator**.

- [ ] **Create a test schema**

In your vault, create `schemas/book/manifest.md`:

```markdown
---
name: book
target:
  folder: "Books/"
fields:
  status:
    type: select
    required: true
    default: "to-read"
    options:
      - value: "📖"
        label: "Reading"
      - value: "✅"
        label: "Done"
      - value: "📚"
        label: "Want to read"
  rating:
    type: number
    min: 1
    max: 5
  icon:
    type: text
    fixed: "📚"
---
```

- [ ] **Create a test note and verify behavior**

Create `Books/Test Book.md` with frontmatter:
```yaml
---
status: draft
rating: 8
---
```

Expected:
1. `icon` field gets auto-set to `📚` (auto-fix on save)
2. `status` row shows ⚠ icon on the right (invalid value "draft")
3. `rating` row shows ⚠ icon (8 > max 5)
4. Clicking ⊞ picker icon next to `status` opens the picker modal
5. Selecting "📖 Reading" from picker updates the frontmatter
6. ⚠ icon disappears from `status` after valid value set

- [ ] **Verify context menu**

Right-click `Books/Test Book.md` in file explorer → **Edit properties** → verify modal shows all fields.

- [ ] **Commit**

```bash
git add .
git commit -m "feat: complete initial implementation of Metadata Validator plugin"
```

---

---

## Task 20: Bases integration

**Files:**
- Create: `src/ui/bases-decorator.ts`
- Modify: `src/main.ts` (register BasesDecorator)

No unit tests — DOM-only. Tested manually.

- [ ] **Create src/ui/bases-decorator.ts**

```typescript
import { App } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import { PickerModal } from "./picker-modal";

/**
 * Intercepts Bases table cell edits and shows the picker modal instead.
 * We do NOT inject icons into every cell (too many cells → slow).
 * Instead, we watch for when a cell becomes editable.
 */
export class BasesDecorator {
  private observer: MutationObserver | null = null;
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly settings: PluginSettings;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, resolver: SchemaResolver, settings: PluginSettings) {
    this.app = app;
    this.resolver = resolver;
    this.settings = settings;
  }

  attach(): void {
    this.observer = new MutationObserver(() => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.onMutation(), 150);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private onMutation(): void {
    // Bases uses contenteditable cells when editing.
    // We look for newly-editable cells that map to a managed field.
    const editableCells = document.querySelectorAll<HTMLElement>(
      ".bases-cell[contenteditable='true']:not([data-mv-intercepted])"
    );

    for (const cell of editableCells) {
      cell.setAttribute("data-mv-intercepted", "true");
      this.interceptCell(cell);
    }
  }

  private interceptCell(cell: HTMLElement): void {
    const rowEl = cell.closest<HTMLElement>("[data-file-path]");
    const filePath = rowEl?.getAttribute("data-file-path");
    const fieldKey = cell.getAttribute("data-property-key") ?? cell.closest<HTMLElement>("[data-property-key]")?.getAttribute("data-property-key");

    if (!filePath || !fieldKey) return;

    const file = this.app.vault.getMarkdownFiles().find(f => f.path === filePath);
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    // Blur the native input immediately and open our picker
    cell.blur();
    cell.setAttribute("contenteditable", "false");

    new PickerModal(
      this.app,
      fieldKey,
      fieldDef,
      frontmatter[fieldKey],
      schema,
      file
    ).open();
  }
}
```

- [ ] **Register in main.ts onload() — add after `this.decorator.attach()`:**

```typescript
// Add import at top:
import { BasesDecorator } from "./ui/bases-decorator";

// Add field declaration after badges:
private basesDecorator!: BasesDecorator;

// In onload(), after this.decorator.attach():
this.basesDecorator = new BasesDecorator(this.app, this.resolver, this.settings);
this.basesDecorator.attach();

// In onunload(), add:
this.basesDecorator.detach();
```

- [ ] **Build and test manually in Obsidian**

Open a Bases table view → click a cell that has a manifest schema → verify picker modal opens instead of inline edit.

- [ ] **Commit**

```bash
git add src/ui/bases-decorator.ts src/main.ts
git commit -m "feat: bases decorator — intercepts Bases cell edits to show picker modal"
```

---

## Task 21: Global validation report modal

**Files:**
- Create: `src/ui/validation-report.ts`
- Modify: `src/main.ts` (add command)

- [ ] **Create src/ui/validation-report.ts**

```typescript
import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ValidationEngine } from "../validation/engine";
import type { ValidationResult } from "../types";

interface NoteReport {
  file: TFile;
  results: ValidationResult[];
}

export class ValidationReportModal extends Modal {
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private reports: NoteReport[] = [];

  constructor(app: App, resolver: SchemaResolver, engine: ValidationEngine) {
    super(app);
    this.resolver = resolver;
    this.engine = engine;
  }

  async onOpen(): Promise<void> {
    this.contentEl.createEl("p", { text: "Scanning vault…" });
    await this.runScan();
    this.render();
  }

  private async runScan(): Promise<void> {
    this.reports = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
      const schema = this.resolver.resolveForNote(file, fm);
      if (!schema) continue;

      const results = await this.engine.validate(file, fm, schema);
      const issues = results.filter(r => !r.autoFixed);
      if (issues.length > 0) {
        this.reports.push({ file, results: issues });
      }
    }

    this.reports.sort((a, b) => {
      const ae = a.results.filter(r => r.severity === "error").length;
      const be = b.results.filter(r => r.severity === "error").length;
      return be - ae;
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Vault validation report" });

    if (this.reports.length === 0) {
      contentEl.createEl("p", { text: "✓ No issues found." });
      return;
    }

    const totalErrors = this.reports.flatMap(r => r.results).filter(r => r.severity === "error").length;
    const summary = contentEl.createEl("p");
    summary.textContent = `${this.reports.length} note(s) with issues · ${totalErrors} error(s) total`;
    summary.style.cssText = "color:var(--text-muted);margin-bottom:12px;";

    for (const report of this.reports) {
      const section = contentEl.createDiv("mv-report-section");
      section.style.cssText = "margin-bottom:12px;border-bottom:1px solid var(--background-modifier-border);padding-bottom:8px;";

      const fileLink = section.createEl("a", { text: report.file.basename });
      fileLink.style.cssText = "font-weight:bold;cursor:pointer;color:var(--link-color);";
      fileLink.addEventListener("click", () => {
        this.app.workspace.openLinkText(report.file.path, "");
        this.close();
      });

      for (const result of report.results) {
        const row = section.createDiv();
        row.style.cssText = "font-size:12px;padding:2px 0;";
        row.createEl("span", {
          text: result.severity === "error" ? "⚠ " : "ℹ ",
        }).style.color = result.severity === "error"
          ? "var(--color-red, #f38ba8)"
          : "var(--color-yellow, #f9e2af)";
        row.createEl("strong", { text: result.field + ": " });
        row.createEl("span", { text: result.message });
      }
    }

    const footer = contentEl.createEl("p");
    footer.style.cssText = "font-size:11px;color:var(--text-faint);margin-top:8px;";
    footer.textContent = `Last scan: ${new Date().toLocaleTimeString()}`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Add command in main.ts onload():**

```typescript
// Add import at top:
import { ValidationReportModal } from "./ui/validation-report";

// Add command:
this.addCommand({
  id: "show-vault-report",
  name: "Show vault validation report",
  callback: () => new ValidationReportModal(this.app, this.resolver, this.engine).open(),
});
```

- [ ] **Commit**

```bash
git add src/ui/validation-report.ts src/main.ts
git commit -m "feat: global validation report — scans all vault notes and lists issues"
```

---

## Task 22: Schema tree view in settings

**Files:**
- Create: `src/ui/schema-tree.ts`
- Modify: `src/settings.ts` (add tree section at bottom of display())

- [ ] **Create src/ui/schema-tree.ts**

```typescript
import type { SchemaResolver } from "../schema/resolver";
import type { ManifestCache } from "../manifest/cache";
import type { App } from "obsidian";

/**
 * Renders an interactive inheritance tree of all discovered manifests.
 * Call render(containerEl) to inject into any HTMLElement (e.g. the settings tab).
 */
export class SchemaTreeView {
  private readonly app: App;
  private readonly cache: ManifestCache;
  private readonly resolver: SchemaResolver;

  constructor(app: App, cache: ManifestCache, resolver: SchemaResolver) {
    this.app = app;
    this.cache = cache;
    this.resolver = resolver;
  }

  render(container: HTMLElement): void {
    container.empty();

    const manifests = this.cache.getAll();
    if (manifests.length === 0) {
      container.createEl("p", { text: "No manifest files found in the schemas folder." });
      return;
    }

    // Build parent→children map
    const childrenOf = new Map<string | null, typeof manifests>();
    for (const m of manifests) {
      const parts = m.folderPath.split("/");
      const parentFolder = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
      const parentManifest = parentFolder ? this.cache.getByFolder(parentFolder) : null;
      const parentKey = m.data.extends
        ? (this.cache.getByFolder(m.data.extends)?.path ?? null)
        : parentManifest?.path ?? null;

      const existing = childrenOf.get(parentKey) ?? [];
      existing.push(m);
      childrenOf.set(parentKey, existing);
    }

    // Find roots (no parent)
    const roots = childrenOf.get(null) ?? [];
    const ul = container.createEl("ul");
    ul.style.cssText = "list-style:none;padding:0;";

    for (const root of roots) {
      this.renderNode(root.path, childrenOf, ul);
    }
  }

  private renderNode(
    manifestPath: string,
    childrenOf: Map<string | null, ReturnType<ManifestCache["getAll"]>>,
    parentEl: HTMLElement
  ): void {
    const manifest = this.cache.getByPath(manifestPath);
    if (!manifest) return;

    const li = parentEl.createEl("li");
    li.style.cssText = "margin:4px 0;";

    const row = li.createDiv();
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;";
    row.addEventListener("mouseenter", () => row.style.background = "var(--background-modifier-hover)");
    row.addEventListener("mouseleave", () => row.style.background = "");

    const children = childrenOf.get(manifestPath) ?? [];
    if (children.length > 0) {
      const toggle = row.createEl("span", { text: "▸" });
      toggle.style.cssText = "font-size:11px;transition:transform 0.15s;min-width:12px;";
      const childUl = li.createEl("ul");
      childUl.style.cssText = "list-style:none;padding-left:16px;display:none;";

      toggle.addEventListener("click", () => {
        const isOpen = childUl.style.display !== "none";
        childUl.style.display = isOpen ? "none" : "block";
        toggle.style.transform = isOpen ? "" : "rotate(90deg)";
      });

      for (const child of children) {
        this.renderNode(child.path, childrenOf, childUl);
      }
    } else {
      row.createEl("span", { text: "·", cls: "mv-tree-leaf" }).style.cssText = "opacity:0.3;min-width:12px;text-align:center;";
    }

    const name = row.createEl("span", {
      text: manifest.data.name ?? manifest.folderPath.split("/").pop() ?? "unknown",
    });
    name.style.fontWeight = "bold";

    const fieldCount = Object.keys(manifest.data.fields ?? {}).length;
    row.createEl("span", { text: `${fieldCount} fields` }).style.cssText = "font-size:11px;color:var(--text-muted);";

    if (manifest.data.target?.folder) {
      row.createEl("span", { text: `📁 ${manifest.data.target.folder}` }).style.cssText = "font-size:11px;color:var(--text-muted);";
    }
    if (manifest.data.target?.tag) {
      row.createEl("span", { text: manifest.data.target.tag }).style.cssText = "font-size:11px;color:var(--tag-color,#89b4fa);";
    }

    // Click to open manifest
    row.addEventListener("click", () => {
      this.app.workspace.openLinkText(manifestPath, "");
    });
  }
}
```

- [ ] **Add tree to settings tab — at the bottom of MetadataValidatorSettingTab.display():**

```typescript
// Add imports at top of settings.ts:
import { SchemaTreeView } from "./ui/schema-tree";
// plugin must expose cache and resolver:

containerEl.createEl("h3", { text: "Schema hierarchy" });
const treeContainer = containerEl.createDiv("mv-schema-tree");
new SchemaTreeView(this.app, this.plugin.cache, this.plugin.resolver).render(treeContainer);

// Add a refresh button
const refreshBtn = containerEl.createEl("button", { text: "Refresh" });
refreshBtn.style.cssText = "margin-top:6px;font-size:12px;";
refreshBtn.addEventListener("click", async () => {
  await this.plugin.reloadSchemas();
  new SchemaTreeView(this.app, this.plugin.cache, this.plugin.resolver).render(treeContainer);
});
```

- [ ] **Expose `cache` and `resolver` as public in main.ts:**

Change in `src/main.ts`:
```typescript
// Change from private to public:
cache!: ManifestCache;
resolver!: SchemaResolver;
```

- [ ] **Commit**

```bash
git add src/ui/schema-tree.ts src/settings.ts src/main.ts
git commit -m "feat: schema tree view in settings — visual inheritance hierarchy"
```

---

## Task 24: Run full test suite

- [ ] **Run all unit tests**

```bash
npm test
```

Expected output: all tests pass. Example:
```
✓ src/manifest/__tests__/parser.test.ts (5 tests)
✓ src/manifest/__tests__/cache.test.ts (3 tests)
✓ src/schema/__tests__/merger.test.ts (5 tests)
✓ src/schema/__tests__/resolver.test.ts (5 tests)
✓ src/schema/__tests__/source-resolver.test.ts (4 tests)
✓ src/validation/rules/__tests__/required.test.ts (6 tests)
✓ src/validation/rules/__tests__/options.test.ts (5 tests)
✓ src/validation/rules/__tests__/link-source.test.ts (4 tests)
✓ src/validation/rules/__tests__/number-range.test.ts (5 tests)
✓ src/validation/__tests__/auto-fix.test.ts (6 tests)
✓ src/validation/__tests__/engine.test.ts (4 tests)

Test Files: 11 passed
Tests:      52 passed
```

- [ ] **Final commit tag**

```bash
git tag v0.1.0
```

---

## Out of scope (v0.1.0)

Per spec section 10 — explicitly deferred to future releases:
- Syncing or exporting schemas
- Network requests of any kind
- Auto-generating manifests from existing notes
- Custom themes / styling for the picker modal
- Multi-vault support
