/**
 * BasesValidator — decorates Bases table cells that fail schema validation
 * with a subtle box-shadow border (mv-bases-error / mv-bases-warning).
 *
 * Reuses ValidationEngine and SchemaResolver. A per-file result cache
 * (filePath → { fmHash, results }) avoids redundant validation calls.
 * Tooltip on mouseenter reuses showValidatorTooltip from validator-tooltip.ts.
 */
import { type App, type EventRef, TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import type { ValidationResult } from "../types";
import type { ValidationEngine } from "../validation/engine";
import { sanitizeFrontmatter } from "../validation/frontmatter";
import type { showValidatorTooltip as showValidatorTooltipType } from "./validator-tooltip";

interface CachedResult {
  fmHash: string;
  results: ValidationResult[];
}

export class BasesValidator {
  private observer: MutationObserver | null = null;
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private readonly settings: PluginSettings;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resultCache = new Map<string, CachedResult>();
  private cacheRef: EventRef | null = null;

  /**
   * Tracks the most recent mouseenter/mouseleave listeners per cell so they
   * can be removed and replaced when results change on re-decoration.
   */
  private readonly tooltipListeners = new WeakMap<
    HTMLElement,
    { enter: EventListener; leave: EventListener }
  >();

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

  attach(): void {
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (
            node instanceof HTMLElement &&
            (node.classList.contains("bases-view") || node.querySelector?.(".bases-view") !== null)
          ) {
            this.scheduleDecorate();
            return;
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });

    this.cacheRef = this.app.metadataCache.on("changed", (file: TFile) => {
      this.resultCache.delete(file.path);
      this.scheduleDecorate();
    });

    // Decorate immediately in case a Bases view is already visible
    this.scheduleDecorate();
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.cacheRef) {
      this.app.metadataCache.offref(this.cacheRef);
      this.cacheRef = null;
    }
    this.clearAll();
  }

  /** Invalidate cached results for a specific file path. */
  invalidate(filePath: string): void {
    this.resultCache.delete(filePath);
  }

  /** Remove all indicator classes and tooltip listeners from the DOM. */
  clearAll(): void {
    document.querySelectorAll<HTMLElement>(".mv-bases-error, .mv-bases-warning").forEach((el) => {
      this.removeTooltipListeners(el);
      el.classList.remove("mv-bases-error", "mv-bases-warning");
    });
    document.getElementById("mv-validator-tooltip")?.remove();
  }

  private scheduleDecorate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.decorateBases(), 50);
  }

  async decorateBases(): Promise<void> {
    if (!this.settings.showBasesErrors) return;

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".bases-view .bases-tr"));

    for (const row of rows) {
      const filePath = this.resolveFilePath(row);
      if (!filePath) continue;

      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !("extension" in file)) continue;
      // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
      const tfile = file as TFile;

      const cache = this.app.metadataCache.getFileCache(tfile);
      const frontmatter = sanitizeFrontmatter(
        cache?.frontmatter as Record<string, unknown> | undefined
      );

      const schema = this.resolver.resolveForNote(tfile, frontmatter);
      if (!schema) continue;

      const fmHash = JSON.stringify(frontmatter);
      const cached = this.resultCache.get(filePath);
      let results: ValidationResult[];
      if (cached && cached.fmHash === fmHash) {
        results = cached.results;
      } else {
        results = await this.engine.validate(tfile, frontmatter, schema);
        this.resultCache.set(filePath, { fmHash, results });
      }

      // Build a map from fieldKey → non-autoFixed results for O(1) cell lookup
      const resultMap = new Map<string, ValidationResult[]>();
      for (const r of results) {
        if (r.autoFixed) continue;
        const existing = resultMap.get(r.field) ?? [];
        existing.push(r);
        resultMap.set(r.field, existing);
      }

      const cells = Array.from(
        row.querySelectorAll<HTMLElement>(".bases-td[data-property^='note.']")
      );
      for (const cell of cells) {
        const rawProp = cell.getAttribute("data-property") ?? "";
        const fieldKey = rawProp.slice("note.".length);
        if (!fieldKey) continue;
        this.applyIndicator(cell, resultMap.get(fieldKey) ?? []);
      }
    }
  }

  private resolveFilePath(row: HTMLElement): string | null {
    const fileCell = row.querySelector<HTMLElement>(".bases-td[data-property='file.name']");
    return fileCell?.querySelector<HTMLElement>("[data-href]")?.getAttribute("data-href") ?? null;
  }

  private applyIndicator(cell: HTMLElement, results: ValidationResult[]): void {
    cell.classList.remove("mv-bases-error", "mv-bases-warning");
    this.removeTooltipListeners(cell);

    const hasError = results.some((r) => r.severity === "error");
    const hasWarning = results.some((r) => r.severity === "warning");

    if (hasError) cell.classList.add("mv-bases-error");
    else if (hasWarning) cell.classList.add("mv-bases-warning");

    if (results.length > 0) {
      const enter: EventListener = () => {
        void import("./validator-tooltip").then(
          (mod: { showValidatorTooltip: typeof showValidatorTooltipType }) => {
            mod.showValidatorTooltip(cell, results);
          }
        );
      };
      const leave: EventListener = () => {
        document.getElementById("mv-validator-tooltip")?.remove();
      };
      cell.addEventListener("mouseenter", enter);
      cell.addEventListener("mouseleave", leave);
      this.tooltipListeners.set(cell, { enter, leave });
    }
  }

  private removeTooltipListeners(el: HTMLElement): void {
    const old = this.tooltipListeners.get(el);
    if (old) {
      el.removeEventListener("mouseenter", old.enter);
      el.removeEventListener("mouseleave", old.leave);
      this.tooltipListeners.delete(el);
    }
  }
}
