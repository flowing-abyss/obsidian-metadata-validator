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
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  private readonly resultCache = new Map<string, CachedResult>();
  private pendingFullDecorate = false;
  private readonly pendingFilePaths = new Set<string>();
  private readonly pendingRows = new Set<HTMLElement>();
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
        // Attribute changes on elements inside a bases-view catch virtual-scroll
        // row reuse (Bases changes data-href in-place rather than removing nodes).
        if (m.type === "attributes") {
          const row = (m.target as HTMLElement).closest?.<HTMLElement>(".bases-view .bases-tr");
          if (row) this.scheduleRows([row]);
          continue;
        }

        const affectedRows = new Set<HTMLElement>();
        const targetRow = (m.target as HTMLElement).closest?.<HTMLElement>(".bases-view .bases-tr");
        if (targetRow) affectedRows.add(targetRow);

        // A newly mounted Bases view needs one complete pass. Mutations inside an
        // existing view only invalidate the rows whose contents were replaced.
        for (const node of Array.from(m.addedNodes)) {
          if (!node.instanceOf(HTMLElement)) continue;
          if (node.classList.contains("bases-view") || node.querySelector(".bases-view")) {
            this.scheduleFullDecorate();
            return;
          }

          const closestRow = node.closest<HTMLElement>(".bases-view .bases-tr");
          if (closestRow) affectedRows.add(closestRow);
          if (node.matches(".bases-tr") && node.closest(".bases-view")) affectedRows.add(node);
          node
            .querySelectorAll<HTMLElement>(".bases-tr")
            .forEach((row) => row.closest(".bases-view") && affectedRows.add(row));
        }

        if (affectedRows.size > 0) this.scheduleRows(affectedRows);
      }
    });
    this.observer.observe(activeDocument.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-href", "data-property"],
    });

    this.cacheRef = this.app.metadataCache.on("changed", (file: TFile) => {
      this.resultCache.delete(file.path);
      this.scheduleFile(file.path);
    });

    // Decorate immediately in case a Bases view is already visible
    this.scheduleFullDecorate();
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.resetPendingDecorations();
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
    activeDocument
      .querySelectorAll<HTMLElement>(".mv-bases-error, .mv-bases-warning")
      .forEach((el) => {
        this.removeTooltipListeners(el);
        el.classList.remove("mv-bases-error", "mv-bases-warning");
      });
    activeDocument.getElementById("mv-validator-tooltip")?.remove();
  }

  private scheduleFullDecorate(): void {
    this.pendingFullDecorate = true;
    this.pendingFilePaths.clear();
    this.pendingRows.clear();
    this.scheduleFlush();
  }

  private scheduleFile(filePath: string): void {
    if (!this.pendingFullDecorate) this.pendingFilePaths.add(filePath);
    this.scheduleFlush();
  }

  private scheduleRows(rows: Iterable<HTMLElement>): void {
    if (!this.pendingFullDecorate) {
      for (const row of rows) this.pendingRows.add(row);
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.flushScheduledDecorations(), 50);
  }

  private async flushScheduledDecorations(): Promise<void> {
    this.debounceTimer = null;
    const fullDecorate = this.pendingFullDecorate;
    const filePaths = Array.from(this.pendingFilePaths);
    const rows = new Set(this.pendingRows);
    this.resetPendingDecorations();

    if (fullDecorate) {
      await this.decorateBases();
      return;
    }

    if (!this.settings.showBasesErrors) return;
    if (filePaths.length > 0) {
      for (const row of activeDocument.querySelectorAll<HTMLElement>(".bases-view .bases-tr")) {
        const filePath = this.resolveFilePath(row);
        if (filePath && filePaths.includes(filePath)) rows.add(row);
      }
    }
    await this.decorateRows(Array.from(rows).filter((row) => row.isConnected));
  }

  private resetPendingDecorations(): void {
    this.pendingFullDecorate = false;
    this.pendingFilePaths.clear();
    this.pendingRows.clear();
  }

  /** Decorate immediately without debounce — call from workspace leaf-change events. */
  decorateNow(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.resetPendingDecorations();
    void this.decorateBases();
  }

  async decorateBases(): Promise<void> {
    if (!this.settings.showBasesErrors) return;

    const rows = Array.from(activeDocument.querySelectorAll<HTMLElement>(".bases-view .bases-tr"));
    await this.decorateRows(rows);
  }

  private async decorateRows(rows: HTMLElement[]): Promise<void> {
    for (const row of rows) {
      // A virtualized cell may have been reused for a file/formula property. It
      // will not appear in the note-cell loop below, so clear only indicators
      // that are now attached to a non-note cell.
      row.querySelectorAll<HTMLElement>(".mv-bases-error, .mv-bases-warning").forEach((cell) => {
        if (!cell.matches(".bases-td[data-property^='note.']")) this.applyIndicator(cell, []);
      });

      const filePath = this.resolveFilePath(row);
      if (!filePath) {
        this.clearRow(row);
        continue;
      }

      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        this.clearRow(row);
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = sanitizeFrontmatter(cache?.frontmatter);

      const schema = this.resolver.resolveForNote(file, frontmatter);
      if (!schema) {
        this.clearRow(row);
        continue;
      }

      const fmHash = JSON.stringify(frontmatter);
      const cached = this.resultCache.get(filePath);
      let results: ValidationResult[];
      if (cached && cached.fmHash === fmHash) {
        results = cached.results;
      } else {
        results = await this.engine.validate(file, frontmatter, schema);
        this.resultCache.set(filePath, { fmHash, results });
      }

      // The row can be recycled while async validation is running. A mutation
      // event will schedule its new contents; do not decorate stale data now.
      if (!row.isConnected || this.resolveFilePath(row) !== filePath) continue;

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

  private clearRow(row: HTMLElement): void {
    row
      .querySelectorAll<HTMLElement>(".mv-bases-error, .mv-bases-warning")
      .forEach((cell) => this.applyIndicator(cell, []));
  }

  private resolveFilePath(row: HTMLElement): string | null {
    const fileCell = row.querySelector<HTMLElement>(".bases-td[data-property='file.name']");
    return fileCell?.querySelector<HTMLElement>("[data-href]")?.getAttribute("data-href") ?? null;
  }

  private applyIndicator(cell: HTMLElement, results: ValidationResult[]): void {
    const hadTooltipListeners = this.removeTooltipListeners(cell);
    if (hadTooltipListeners) activeDocument.getElementById("mv-validator-tooltip")?.remove();

    const hasError = results.some((r) => r.severity === "error");
    const hasWarning = results.some((r) => r.severity === "warning");
    const showWarning = !hasError && hasWarning;

    // toggle(force) leaves the DOM untouched when the class is already in the
    // requested state, avoiding attribute mutations for every valid cell.
    cell.classList.toggle("mv-bases-error", hasError);
    cell.classList.toggle("mv-bases-warning", showWarning);

    if (hasError || showWarning) {
      const enter: EventListener = () => {
        void import("./validator-tooltip").then(
          (mod: { showValidatorTooltip: typeof showValidatorTooltipType }) => {
            mod.showValidatorTooltip(cell, results);
          }
        );
      };
      const leave: EventListener = () => {
        activeDocument.getElementById("mv-validator-tooltip")?.remove();
      };
      cell.addEventListener("mouseenter", enter);
      cell.addEventListener("mouseleave", leave);
      this.tooltipListeners.set(cell, { enter, leave });
    }
  }

  private removeTooltipListeners(el: HTMLElement): boolean {
    const old = this.tooltipListeners.get(el);
    if (old) {
      el.removeEventListener("mouseenter", old.enter);
      el.removeEventListener("mouseleave", old.leave);
      this.tooltipListeners.delete(el);
      return true;
    }
    return false;
  }
}
