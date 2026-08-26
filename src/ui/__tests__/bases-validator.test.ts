import { type App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSettings } from "../../settings";
import type { ResolvedSchema, ValidationResult } from "../../types";
import type { SchemaResolver } from "../../schema/resolver";
import type { ValidationEngine } from "../../validation/engine";
import { BasesValidator } from "../bases-validator";

// ── DOM helpers ──────────────────────────────────────────────

function makeFile(path: string): TFile {
  const mockVault = {} as any;
  return TFile.create__(mockVault, path);
}

function makeSchema(): ResolvedSchema {
  return {
    manifestPath: "schemas/proj/manifest.md",
    inheritanceChain: ["schemas/proj/manifest.md"],
    name: "proj",
    priority: 0,
    target: {},
    fields: { status: { type: "select" }, rating: { type: "number", required: true } },
    formatting: {},
  };
}

function renderBasesRow(filePath: string, cells: Record<string, string>): void {
  const cellsHtml = Object.entries(cells)
    .map(([prop, content]) => `<td class="bases-td" data-property="note.${prop}">${content}</td>`)
    .join("");
  document.body.innerHTML = `
    <div class="bases-view">
      <table>
        <tbody>
          <tr class="bases-tr">
            <td class="bases-td" data-property="file.name">
              <a data-href="${filePath}">${filePath}</a>
            </td>
            ${cellsHtml}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function makeContext(
  results: ValidationResult[] = [],
  schema: ResolvedSchema | null = makeSchema()
) {
  const file = makeFile("Notes/proj.md");

  const app = {
    vault: {
      getAbstractFileByPath: vi.fn((_path: string) => file),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({ frontmatter: { status: "draft", rating: null } })),
      on: vi.fn(),
      offref: vi.fn(),
    },
  } as unknown as App;

  const resolver = {
    resolveForNote: vi.fn(() => schema),
  } as unknown as SchemaResolver;

  const engine = {
    validate: vi.fn().mockResolvedValue(results),
  } as unknown as ValidationEngine;

  const settings = { showBasesErrors: true } as PluginSettings;

  const validator = new BasesValidator(app, resolver, engine, settings);

  return { validator, app, engine };
}

// ── Tests ────────────────────────────────────────────────────

describe("BasesValidator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("applies mv-bases-error to a cell with an error result", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "error",
        message: "Invalid option.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(true);
    expect(cell?.classList.contains("mv-bases-warning")).toBe(false);
  });

  it("applies mv-bases-warning to a cell with a warning result", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "warning",
        message: "Soft warning.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-warning")).toBe(true);
    expect(cell?.classList.contains("mv-bases-error")).toBe(false);
  });

  it("prefers mv-bases-error over mv-bases-warning when both exist on same field", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "warning",
        message: "Warning.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
      {
        field: "status",
        severity: "error",
        message: "Error.",
        rule: "required",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(true);
    expect(cell?.classList.contains("mv-bases-warning")).toBe(false);
  });

  it("applies no class to a cell that is not in the results", async () => {
    const results: ValidationResult[] = [
      {
        field: "rating",
        severity: "error",
        message: "Required.",
        rule: "required",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "Active", rating: "" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const statusCell = document.querySelector<HTMLElement>(
      ".bases-td[data-property='note.status']"
    );
    expect(statusCell?.classList.contains("mv-bases-error")).toBe(false);
    expect(statusCell?.classList.contains("mv-bases-warning")).toBe(false);
  });

  it("skips cells for autoFixed results", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "info",
        message: "Auto-corrected.",
        rule: "fixed",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: true,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(false);
    expect(cell?.classList.contains("mv-bases-warning")).toBe(false);
  });

  it("does nothing when showBasesErrors is false", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "error",
        message: "Error.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    (validator as unknown as { settings: PluginSettings }).settings.showBasesErrors = false;
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(false);
  });

  it("skips rows with no resolvable file path", async () => {
    document.body.innerHTML = `
      <div class="bases-view">
        <table><tbody>
          <tr class="bases-tr">
            <td class="bases-td" data-property="file.name"><span>no link</span></td>
            <td class="bases-td" data-property="note.status">draft</td>
          </tr>
        </tbody></table>
      </div>
    `;
    const { validator, engine } = makeContext([]);
    await validator.decorateBases();
    expect(engine.validate).not.toHaveBeenCalled();
  });

  it("caches validation results and only calls engine once per fmHash", async () => {
    const results: ValidationResult[] = [];
    renderBasesRow("Notes/proj.md", { status: "Active" });

    const { validator, engine } = makeContext(results);
    await validator.decorateBases();
    await validator.decorateBases();

    expect(engine.validate).toHaveBeenCalledTimes(1);
  });

  it("re-validates after cache is cleared for a file", async () => {
    const results: ValidationResult[] = [];
    renderBasesRow("Notes/proj.md", { status: "Active" });

    const { validator, engine } = makeContext(results);
    await validator.decorateBases();
    validator.invalidate("Notes/proj.md");
    await validator.decorateBases();

    expect(engine.validate).toHaveBeenCalledTimes(2);
  });

  it("clearAll removes indicator classes from all cells", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "error",
        message: "Error.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(true);

    validator.clearAll();
    expect(cell?.classList.contains("mv-bases-error")).toBe(false);
  });

  it("opens the validator tooltip when hovering an invalid cell", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "error",
        message: "Invalid option.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });

    const { validator } = makeContext(results);
    await validator.decorateBases();

    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    cell?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.getElementById("mv-validator-tooltip")).not.toBeNull();
    });
  });

  it("redecorates only rows for the file reported by metadataCache.changed", async () => {
    vi.useFakeTimers();
    const fileA = makeFile("Notes/a.md");
    const fileB = makeFile("Notes/b.md");
    document.body.innerHTML = `
      <div class="bases-view"><table><tbody>
        <tr class="bases-tr">
          <td class="bases-td" data-property="file.name"><a data-href="Notes/a.md">a</a></td>
          <td class="bases-td" data-property="note.status">draft</td>
        </tr>
        <tr class="bases-tr">
          <td class="bases-td" data-property="file.name"><a data-href="Notes/b.md">b</a></td>
          <td class="bases-td" data-property="note.status">draft</td>
        </tr>
      </tbody></table></div>
    `;

    let changed: ((file: TFile) => void) | null = null;
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => (path === fileA.path ? fileA : fileB)),
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { status: "draft" } }),
        on: vi.fn((_event: string, callback: (file: TFile) => void) => {
          changed = callback;
          return {};
        }),
        offref: vi.fn(),
      },
    } as unknown as App;
    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    } as unknown as SchemaResolver;
    const engine = {
      validate: vi.fn().mockResolvedValue([]),
    } as unknown as ValidationEngine;
    const validator = new BasesValidator(app, resolver, engine, {
      showBasesErrors: true,
    } as PluginSettings);

    validator.attach();
    try {
      await vi.runAllTimersAsync();
      expect(engine.validate).toHaveBeenCalledTimes(2);
      vi.mocked(engine.validate).mockClear();

      validator.invalidate(fileA.path);
      if (!changed) throw new Error("metadataCache.changed callback was not registered");
      changed(fileA);
      await vi.runAllTimersAsync();

      expect(engine.validate).toHaveBeenCalledOnce();
      expect(engine.validate).toHaveBeenCalledWith(fileA, expect.any(Object), expect.any(Object));
    } finally {
      validator.detach();
      vi.useRealTimers();
    }
  });

  it("redecorates only the row affected by a Bases DOM mutation", async () => {
    vi.useFakeTimers();
    const fileA = makeFile("Notes/a.md");
    const fileB = makeFile("Notes/b.md");
    document.body.innerHTML = `
      <div class="bases-view"><table><tbody>
        <tr class="bases-tr" data-row="a">
          <td class="bases-td" data-property="file.name"><a data-href="Notes/a.md">a</a></td>
          <td class="bases-td" data-property="note.status">draft</td>
        </tr>
        <tr class="bases-tr" data-row="b">
          <td class="bases-td" data-property="file.name"><a data-href="Notes/b.md">b</a></td>
          <td class="bases-td" data-property="note.status">draft</td>
        </tr>
      </tbody></table></div>
    `;
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => (path === fileA.path ? fileA : fileB)),
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { status: "draft" } }),
        on: vi.fn(() => ({})),
        offref: vi.fn(),
      },
    } as unknown as App;
    const resolver = {
      resolveForNote: vi.fn(() => makeSchema()),
    } as unknown as SchemaResolver;
    const engine = {
      validate: vi.fn().mockResolvedValue([]),
    } as unknown as ValidationEngine;
    const validator = new BasesValidator(app, resolver, engine, {
      showBasesErrors: true,
    } as PluginSettings);

    validator.attach();
    try {
      await vi.runAllTimersAsync();
      vi.mocked(resolver.resolveForNote).mockClear();

      document
        .querySelector<HTMLElement>("[data-row='a'] .bases-td[data-property='note.status']")
        ?.append(document.createElement("span"));
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(resolver.resolveForNote).toHaveBeenCalledOnce();
      expect(app.vault.getAbstractFileByPath).toHaveBeenLastCalledWith(fileA.path);
    } finally {
      validator.detach();
      vi.useRealTimers();
    }
  });

  it("does not mutate class attributes when indicator state is unchanged", async () => {
    renderBasesRow("Notes/proj.md", { status: "draft" });
    const { validator } = makeContext([]);
    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    if (!cell) throw new Error("status cell was not rendered");
    let classMutations = 0;
    const observer = new MutationObserver((mutations) => {
      classMutations += mutations.filter((m) => m.attributeName === "class").length;
    });
    observer.observe(cell, { attributes: true, attributeFilter: ["class"] });

    await validator.decorateBases();
    await validator.decorateBases();
    await Promise.resolve();
    observer.disconnect();

    expect(classMutations).toBe(0);
  });

  it("clears a stale indicator when virtual scroll reuses a cell for a non-note property", async () => {
    const results: ValidationResult[] = [
      {
        field: "status",
        severity: "error",
        message: "Invalid option.",
        rule: "options",
        manifestPath: "schemas/proj/manifest.md",
        autoFixed: false,
      },
    ];
    renderBasesRow("Notes/proj.md", { status: "draft" });
    const { validator } = makeContext(results);
    await validator.decorateBases();
    const cell = document.querySelector<HTMLElement>(".bases-td[data-property='note.status']");
    expect(cell?.classList.contains("mv-bases-error")).toBe(true);

    cell?.setAttribute("data-property", "formula.status");
    await validator.decorateBases();

    expect(cell?.classList.contains("mv-bases-error")).toBe(false);
  });
});
