import { App } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import { PickerModal } from "./picker-modal";

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
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private onMutation(): void {
    if (!this.settings.showInlineErrors) return;

    // Target cells not yet intercepted
    const cells = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".bases-cell:not([data-mv-intercepted]), [data-bases-cell]:not([data-mv-intercepted])"
      )
    );

    for (const cell of cells) {
      cell.setAttribute("data-mv-intercepted", "true");
      this.addCellClickHandler(cell);
    }
  }

  private addCellClickHandler(cell: HTMLElement): void {
    cell.addEventListener("click", (e) => {
      const rowEl = cell.closest<HTMLElement>("[data-file-path]");
      const filePath = rowEl?.getAttribute("data-file-path");
      const fieldKey =
        cell.getAttribute("data-property-key") ??
        cell.closest<HTMLElement>("[data-property-key]")?.getAttribute("data-property-key");

      if (!filePath || !fieldKey) return;

      const file = this.app.vault.getMarkdownFiles().find((f) => f.path === filePath);
      if (!file) return;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
      const schema = this.resolver.resolveForNote(file, frontmatter);
      if (!schema) return;

      const fieldDef = schema.fields[fieldKey];
      if (!fieldDef) return;

      // Only intercept for fields with schema definitions
      e.preventDefault();
      e.stopPropagation();
      new PickerModal(this.app, fieldKey, fieldDef, frontmatter[fieldKey], schema, file).open();
    });
  }
}
