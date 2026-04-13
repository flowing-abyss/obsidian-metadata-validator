/**
 * BasesDecorator — intercepts clicks on Bases table cells and opens
 * PickerModal / QuickEditModal for fields that have a schema definition.
 *
 * Uses pure event delegation: a single capture listener on document.body.
 * PickerModal and QuickEditModal are lazily imported on first click.
 */
import { App, TFile, type EventRef } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import type { PickerModal as PickerModalType } from "./picker-modal";
import type { QuickEditModal as QuickEditModalType } from "./quick-edit-modal";

const PICKER_TYPES = new Set(["select", "multiselect", "link", "multilink"]);

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

  private boundContextHandler: ((e: MouseEvent) => void) | null = null;
  private boundMouseDownHandler: ((e: MouseEvent) => void) | null = null;

  attach(): void {
    this.boundHandler = (e: MouseEvent) => this.onClick(e);
    document.body.addEventListener("click", this.boundHandler, { capture: true });

    this.boundContextHandler = (e: MouseEvent) => this.onContextMenu(e);
    document.body.addEventListener("contextmenu", this.boundContextHandler, { capture: true });

    // Intercept right-click mousedown at WINDOW level (above document in the capture chain).
    // Bases is a built-in plugin loaded before us, so its document-level capture handlers
    // are registered first and fire before ours. By moving to window-capture we are guaranteed
    // to fire before any document-level handler — stopPropagation here prevents Bases from
    // ever seeing the mousedown and starting a "pending edit" that would later commit the old
    // value and race with our picker's save.
    this.boundMouseDownHandler = (e: MouseEvent) => this.onMouseDown(e);
    window.addEventListener("mousedown", this.boundMouseDownHandler, { capture: true });
  }

  detach(): void {
    if (this.boundHandler) {
      document.body.removeEventListener("click", this.boundHandler, { capture: true });
      this.boundHandler = null;
    }
    if (this.boundContextHandler) {
      document.body.removeEventListener("contextmenu", this.boundContextHandler, { capture: true });
      this.boundContextHandler = null;
    }
    if (this.boundMouseDownHandler) {
      window.removeEventListener("mousedown", this.boundMouseDownHandler, { capture: true });
      this.boundMouseDownHandler = null;
    }
  }

  /**
   * Intercepts right-click (button=2) mousedown on Bases cells we own, at the document
   * capture phase — BEFORE any document.body-level handlers that Bases may have registered.
   * Stopping propagation here prevents Bases from starting a "pending edit" on right-click
   * that would later commit the old value and race with our picker's save.
   */
  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 2) return;
    if (!this.settings.interceptBases) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(".bases-view")) return;

    // Skip links — Obsidian handles their right-click natively.
    if (target.closest("a") ?? target.closest("[data-href]")) return;

    const cell = target.closest<HTMLElement>(".bases-td[data-property]");
    if (!cell) return;

    const CONTAINERS = new Set(["DIV", "TD", "TR", "TABLE", "TBODY", "THEAD"]);
    if (!CONTAINERS.has(target.tagName)) return;

    const rawProp = cell.getAttribute("data-property") ?? "";
    if (!rawProp.startsWith("note.")) return;

    // We will handle this right-click via contextmenu — stop ALL handlers below window
    // (including Bases' document-level capture handlers registered before us) from seeing
    // this mousedown. stopImmediatePropagation also blocks any other window-level handlers.
    e.stopImmediatePropagation();
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.settings.interceptBases) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(".bases-view")) return;

    // Skip right-clicks on links — let Obsidian handle the file context menu
    if (target.closest("a") ?? target.closest("[data-href]")) return;

    const cell = target.closest<HTMLElement>(".bases-td[data-property]");
    if (!cell) return;

    // Only intercept right-click on empty space (container elements like div/td).
    // Right-click on a value chip (span, etc.) should show the native context menu.
    const CONTAINERS = new Set(["DIV", "TD", "TR", "TABLE", "TBODY", "THEAD"]);
    if (!CONTAINERS.has(target.tagName)) return;

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

    e.preventDefault();
    e.stopImmediatePropagation();

    // Bases may have started an inline edit session on mousedown (before contextmenu fired).
    // Dispatching Escape to any focused element inside the Bases view cancels that session
    // without committing the old value — exactly as if the user pressed Escape themselves.
    const focused = document.activeElement as HTMLElement | null;
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
    window.requestAnimationFrame(() => {
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
        if (typeof savedValue !== "string" && savedValue !== null) return;

        let seenCorrect = false;
        const deadline = Date.now() + 3000;
        let ref: EventRef | null = null;

        const cleanup = () => {
          if (ref) {
            app.metadataCache.offref(ref);
            ref = null;
          }
        };

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
        window.setTimeout(cleanup, 3100);
      };

      if (PICKER_TYPES.has(capturedFieldDef.type)) {
        void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
          new mod.PickerModal(
            app,
            capturedFieldKey,
            capturedFieldDef,
            freshFm[capturedFieldKey],
            capturedSchema,
            capturedFile,
            buildOnSaved(capturedFieldKey, capturedFile)
          ).open();
        });
      } else {
        void import("./quick-edit-modal").then(
          (mod: { QuickEditModal: typeof QuickEditModalType }) => {
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

    // Only intercept left-clicks on actual value elements (chips, spans, text nodes).
    // Container elements (div, td) mean the user clicked on empty padding — let Bases handle it.
    const CONTAINERS = new Set(["DIV", "TD", "TR", "TABLE", "TBODY", "THEAD"]);
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
}
