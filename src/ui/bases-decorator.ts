/**
 * BasesDecorator — intercepts clicks inside Obsidian Bases tables/grids
 * and opens PickerModal for fields that have a schema definition.
 *
 * Uses pure event delegation: a single click listener on document.body.
 * Zero cost while the user isn't clicking; no MutationObserver needed.
 */
import { App } from "obsidian";
import type { TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import type { PickerModal as PickerModalType } from "./picker-modal";
import type { QuickEditModal as QuickEditModalType } from "./quick-edit-modal";

/** Attribute we stamp on cells once we've processed the click */
const HANDLED_ATTR = "data-mv-intercepted";

/** All candidate selectors for a Bases cell element. Bases may use any of these. */
const CELL_SELECTORS = [
  ".bases-cell",
  "[data-bases-cell]",
  "td[data-col]",
  "td[data-field]",
  "td[data-property]",
  ".bases-table-cell",
  ".database-cell",
  "[data-type='bases'] td",
].join(", ");

/** Candidate selectors for the row that carries the file path. */
const ROW_SELECTORS = [
  "[data-file-path]",
  "[data-path]",
  "[data-filepath]",
  "tr[data-id]",
  "[data-row-id]",
];

/** Candidate selectors for the column header that carries the field key. */
const COL_ATTR_CANDIDATES = [
  "data-property-key",
  "data-col",
  "data-field",
  "data-property",
  "data-column-id",
  "data-key",
];

export class BasesDecorator {
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly settings: PluginSettings;
  private boundHandler: ((e: MouseEvent) => void) | null = null;

  constructor(app: App, resolver: SchemaResolver, settings: PluginSettings) {
    this.app = app;
    this.resolver = resolver;
    this.settings = settings;
  }

  attach(): void {
    this.boundHandler = (e: MouseEvent) => this.onClick(e);
    document.body.addEventListener("click", this.boundHandler, { capture: true });
  }

  detach(): void {
    if (this.boundHandler) {
      document.body.removeEventListener("click", this.boundHandler, { capture: true });
      this.boundHandler = null;
    }
  }

  private onClick(e: MouseEvent): void {
    if (!this.settings.showInlineErrors) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Quick-exit: only process clicks inside a Bases leaf
    const basesLeaf = target.closest(
      '.workspace-leaf-content[data-type="bases"], .bases-view, [data-bases-view]'
    );
    if (!basesLeaf) return;

    // Find the cell element
    const cell = target.closest<HTMLElement>(CELL_SELECTORS);
    if (!cell) return;

    // Skip if already handled this exact cell click path
    if (cell.hasAttribute(HANDLED_ATTR)) return;

    const filePath = this.extractFilePath(cell);
    const fieldKey = this.extractFieldKey(cell, basesLeaf as HTMLElement);
    if (!filePath || !fieldKey) return;

    const file = this.app.vault.getMarkdownFiles().find((f) => f.path === filePath);
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    // We have a schema match — intercept the click
    e.preventDefault();
    e.stopPropagation();

    const PICKER_TYPES = new Set(["select", "multiselect", "link", "multilink"]);

    if (PICKER_TYPES.has(fieldDef.type)) {
      void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
        new mod.PickerModal(
          this.app,
          fieldKey,
          fieldDef,
          frontmatter[fieldKey],
          schema,
          file
        ).open();
      });
    } else {
      void import("./quick-edit-modal").then(
        (mod: { QuickEditModal: typeof QuickEditModalType }) => {
          new mod.QuickEditModal(this.app, file, fieldKey, fieldDef, frontmatter[fieldKey]).open();
        }
      );
    }
  }

  /** Walk up from the cell to find the row element that carries the file path. */
  private extractFilePath(cell: HTMLElement): string | null {
    for (const sel of ROW_SELECTORS) {
      const row = cell.closest<HTMLElement>(sel);
      if (!row) continue;
      for (const attr of [
        "data-file-path",
        "data-path",
        "data-filepath",
        "data-id",
        "data-row-id",
      ]) {
        const val = row.getAttribute(attr);
        if (val?.endsWith(".md")) return val;
      }
    }
    return null;
  }

  /**
   * Try to determine the field key for the clicked cell.
   * Bases may store it on the cell itself, on the row, or implied by column position.
   */
  private extractFieldKey(cell: HTMLElement, basesLeaf: HTMLElement): string | null {
    // 1. Check the cell element and its ancestors for data attributes
    let el: HTMLElement | null = cell;
    while (el && el !== basesLeaf) {
      for (const attr of COL_ATTR_CANDIDATES) {
        const val = el.getAttribute(attr);
        if (val) return val;
      }
      el = el.parentElement;
    }

    // 2. Column-index approach: find the cell's column index in its row,
    //    then look at the corresponding header cell
    const row = cell.closest("tr");
    if (!row) return null;
    const cells = Array.from(row.querySelectorAll<HTMLElement>("td"));
    const colIdx = cells.indexOf(cell);
    if (colIdx === -1) return null;

    const table = cell.closest("table");
    if (!table) return null;
    const headerCells = Array.from(table.querySelectorAll("thead th, thead td"));
    const header = headerCells[colIdx];
    if (!header) return null;

    for (const attr of COL_ATTR_CANDIDATES) {
      const val = header.getAttribute(attr);
      if (val) return val;
    }

    // 3. Fall back to header text content (may match a field key directly)
    const text = header.textContent?.trim().toLowerCase().replace(/\s+/g, "_");
    return text ?? null;
  }
}
