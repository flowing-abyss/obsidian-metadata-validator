/**
 * BasesDecorator — intercepts clicks on Bases table cells and opens
 * PickerModal / QuickEditModal for fields that have a schema definition.
 *
 * Uses delegated capture listeners; native inline editors keep their left-clicks.
 * PickerModal and QuickEditModal are lazily imported on first click.
 */
import { App, Component, TFile, type EventRef } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import type { PickerModal as PickerModalType } from "./picker-modal";
import type { QuickEditModal as QuickEditModalType } from "./quick-edit-modal";

const PICKER_TYPES = new Set(["select", "multiselect", "link", "multilink"]);
const CHECKBOX_SELECTOR = "input[type='checkbox'], [role='checkbox']";
const NATIVE_EDITOR_SELECTOR = "input, textarea, select, [contenteditable]";
const CONTAINERS = new Set(["DIV", "TD", "TR", "TABLE", "TBODY", "THEAD"]);

export class BasesDecorator {
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly settings: PluginSettings;
  private component: Component | null = null;
  private readonly pendingCleanups = new Set<() => void>();

  constructor(app: App, resolver: SchemaResolver, settings: PluginSettings) {
    this.app = app;
    this.resolver = resolver;
    this.settings = settings;
  }

  attach(): void {
    if (this.component) return;
    const component = new Component();
    this.component = component;
    component.load();
    const body = activeDocument.body;
    component.registerDomEvent(body, "click", (e) => this.onClick(e), { capture: true });
    component.registerDomEvent(body, "contextmenu", (e) => this.onContextMenu(e), {
      capture: true,
    });

    // Intercept right-click mousedown at WINDOW level (above document in the capture chain).
    // Bases is a built-in plugin loaded before us, so its document-level capture handlers
    // are registered first and fire before ours. By moving to window-capture we are guaranteed
    // to fire before any document-level handler — stopPropagation here prevents Bases from
    // ever seeing the mousedown and starting a "pending edit" that would later commit the old
    // value and race with our picker's save.
    component.registerDomEvent(body.win, "mousedown", (e) => this.onMouseDown(e), {
      capture: true,
    });
    component.register(() => {
      for (const cleanup of this.pendingCleanups) cleanup();
      this.pendingCleanups.clear();
    });
  }

  detach(): void {
    const component = this.component;
    this.component = null;
    component?.unload();
  }

  private isNativeEditor(target: HTMLElement, cell: HTMLElement): boolean {
    // Live Preview embeds live inside CodeMirror's contenteditable root. Only
    // editors within this cell count, and contenteditable=false stops the search.
    const editor = target.closest(NATIVE_EDITOR_SELECTOR);
    return (
      editor !== null &&
      cell.contains(editor) &&
      (editor.matches("input, textarea, select") || !editor.matches("[contenteditable='false']"))
    );
  }

  /**
   * Stop right-clicks we handle at window capture, before Bases starts an inline edit.
   * Prevent the input's default focus action too: opening two editors for the same
   * cell lets Bases commit its old value after our modal saves.
   */
  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 2) return;
    if (!this.resolveContextMenu(e)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private resolveContextMenu(e: MouseEvent) {
    if (!this.settings.interceptBases) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(".bases-view")) return;

    // Skip right-clicks on links — let Obsidian handle the file context menu
    if (target.closest("a") ?? target.closest("[data-href]")) return;
    if (target.closest(CHECKBOX_SELECTOR)) return;

    const cell = target.closest<HTMLElement>(".bases-td[data-property]");
    if (!cell) return;

    // Native editors (including number inputs) and cell padding open our modal.
    // Value chips keep their native context menu.
    if (!CONTAINERS.has(target.tagName) && !this.isNativeEditor(target, cell)) return;

    const rawProp = cell.getAttribute("data-property") ?? "";
    if (!rawProp.startsWith("note.")) return;
    const fieldKey = rawProp.slice("note.".length);
    if (!fieldKey) return;

    const row = cell.closest<HTMLElement>(".bases-tr");
    if (!row) return;
    const fileCell = row.querySelector<HTMLElement>(".bases-td[data-property='file.name']");
    const filePath =
      fileCell?.querySelector<HTMLElement>("[data-href]")?.getAttribute("data-href") ?? null;
    if (!filePath) return;

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    return { file, fieldKey, fieldDef, schema, cell };
  }

  private onContextMenu(e: MouseEvent): void {
    const component = this.component;
    if (!component) return;
    const context = this.resolveContextMenu(e);
    if (!context) return;
    const { file, fieldKey, fieldDef, schema, cell } = context;
    const viewWindow = cell.win;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Bases may have started an inline edit session on mousedown (before contextmenu fired).
    // Dispatching Escape to any focused element inside the Bases view cancels that session
    // without committing the old value — exactly as if the user pressed Escape themselves.
    const focused = cell.doc.activeElement as HTMLElement | null;
    if (focused?.closest(".bases-view")) {
      focused.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    }

    // Capture variables needed inside the callback before any async work.
    const app = this.app;
    const capturedFieldKey = fieldKey;
    const capturedFieldDef = fieldDef;
    const capturedSchema = schema;
    const capturedFile = file;

    // Delay by one animation frame so the Escape above finishes processing
    // synchronously before our modal steals focus.
    let frame = 0;
    const cancelFrame = () => viewWindow.cancelAnimationFrame(frame);
    this.pendingCleanups.add(cancelFrame);
    frame = viewWindow.requestAnimationFrame(() => {
      this.pendingCleanups.delete(cancelFrame);
      if (this.component !== component) return;
      // Re-read frontmatter at open time so the picker shows the latest value.
      const freshFm = (app.metadataCache.getFileCache(capturedFile)?.frontmatter ?? {}) as Record<
        string,
        unknown
      >;

      // After the picker saves a scalar value, Bases may commit its own stale edit
      // session (started on mousedown) slightly later — writing the old value back via
      // vault.modify or processFrontMatter.  We detect this through metadataCache.changed:
      // once we confirm the correct value reached the cache, we watch for a revert and
      // immediately re-apply.  Array values are skipped (multiselect with unmanaged
      // entries is complex; the path through processFrontMatter handles those correctly).
      const buildOnSaved = (fieldKey: string, file: TFile) => (savedValue: unknown) => {
        if (this.component !== component) return;
        if (typeof savedValue !== "string" && savedValue !== null) return;

        let seenCorrect = false;
        const deadline = Date.now() + 3000;
        let ref: EventRef | null = null;
        let timer: number | undefined;

        const cleanup = () => {
          if (ref) {
            app.metadataCache.offref(ref);
            ref = null;
          }
          if (timer !== undefined) viewWindow.clearTimeout(timer);
          this.pendingCleanups.delete(cleanup);
        };

        this.pendingCleanups.add(cleanup);
        ref = app.metadataCache.on("changed", (changedFile: TFile) => {
          if (changedFile.path !== file.path) return;
          if (Date.now() > deadline) {
            cleanup();
            return;
          }
          const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
            string,
            unknown
          >;
          const current = fm[fieldKey];
          if (current === savedValue) {
            // Our value is now in the cache — start watching for a Bases revert.
            seenCorrect = true;
          } else if (seenCorrect) {
            // Value was correct but has been overwritten (Bases committed old value).
            cleanup();
            void app.fileManager.processFrontMatter(file, (latestFm) => {
              const latestFrontmatter = latestFm as Record<string, unknown>;
              latestFrontmatter[fieldKey] = savedValue;
            });
          }
        });

        // Safety net: always unregister after the watch window closes.
        timer = viewWindow.setTimeout(cleanup, 3100);
      };

      if (PICKER_TYPES.has(capturedFieldDef.type)) {
        void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
          if (this.component !== component) return;
          new mod.PickerModal(
            app,
            capturedFieldKey,
            capturedFieldDef,
            freshFm[capturedFieldKey],
            capturedSchema,
            capturedFile,
            buildOnSaved(capturedFieldKey, capturedFile),
            this.settings.enableJsExecution
          ).open();
        });
      } else {
        void import("./quick-edit-modal").then(
          (mod: { QuickEditModal: typeof QuickEditModalType }) => {
            if (this.component !== component) return;
            new mod.QuickEditModal(
              app,
              capturedFile,
              capturedFieldKey,
              capturedFieldDef,
              freshFm[capturedFieldKey]
            ).open();
          }
        );
      }
    });
  }

  private onClick(e: MouseEvent): void {
    const component = this.component;
    if (!component) return;
    if (!this.settings.interceptBases) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Quick exit — only process clicks inside a Bases view
    if (!target.closest(".bases-view")) return;

    // Don't intercept clicks on wikilinks — let Obsidian handle link navigation
    if (target.closest("a") ?? target.closest("[data-href]")) return;

    // Find the cell with a data-property attribute
    const cell = target.closest<HTMLElement>(".bases-td[data-property]");
    if (!cell) return;

    // Bases starts native edits on mousedown, before this click. Opening a modal
    // here leaves that edit alive and its stale value can overwrite our save.
    // Keep left-clicks native; the schema-aware editor is available on right-click.
    if (this.isNativeEditor(target, cell) || target.closest(CHECKBOX_SELECTOR)) return;

    // Only intercept left-clicks on actual value elements (chips, spans, text nodes).
    // Container elements (div, td) mean the user clicked on empty padding — let Bases handle it.
    if (CONTAINERS.has(target.tagName)) return;

    const rawProp = cell.getAttribute("data-property") ?? "";
    // Skip Bases built-in properties (file.name, file.ctime, etc.)
    if (!rawProp.startsWith("note.")) return;

    const fieldKey = rawProp.slice("note.".length);
    if (!fieldKey) return;

    // Resolve file path from the file.name cell in the same row
    const row = cell.closest<HTMLElement>(".bases-tr");
    if (!row) return;

    const fileCell = row.querySelector<HTMLElement>(".bases-td[data-property='file.name']");
    const filePath =
      fileCell?.querySelector<HTMLElement>("[data-href]")?.getAttribute("data-href") ?? null;
    if (!filePath) return;

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    // Intercept the click — open our editor instead
    e.preventDefault();
    e.stopPropagation();

    if (PICKER_TYPES.has(fieldDef.type)) {
      void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
        if (this.component !== component) return;
        new mod.PickerModal(
          this.app,
          fieldKey,
          fieldDef,
          frontmatter[fieldKey],
          schema,
          file,
          undefined,
          this.settings.enableJsExecution
        ).open();
      });
    } else {
      void import("./quick-edit-modal").then(
        (mod: { QuickEditModal: typeof QuickEditModalType }) => {
          if (this.component !== component) return;
          new mod.QuickEditModal(this.app, file, fieldKey, fieldDef, frontmatter[fieldKey]).open();
        }
      );
    }
  }
}
