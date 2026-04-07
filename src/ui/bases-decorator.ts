/**
 * BasesDecorator — перехватывает клики по ячейкам таблиц Bases и открывает
 * PickerModal / QuickEditModal для полей с определением в схеме.
 *
 * Event delegation: один capture-listener на document.body.
 * PickerModal и QuickEditModal импортируются лениво — только при первом клике.
 */
import { App } from "obsidian";
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

    // Быстрый выход — только внутри Bases-вида
    if (!target.closest(".bases-view")) return;

    // Найти ячейку data-property="note.*"
    const cell = target.closest<HTMLElement>(".bases-td[data-property]");
    if (!cell) return;

    const rawProp = cell.getAttribute("data-property") ?? "";
    // Пропускаем встроенные свойства Bases (file.name, file.ctime и т.д.)
    if (!rawProp.startsWith("note.")) return;

    const fieldKey = rawProp.slice("note.".length);
    if (!fieldKey) return;

    // Путь к файлу — ищем в ячейке file.name той же строки
    const row = cell.closest<HTMLElement>(".bases-tr");
    if (!row) return;

    const fileCell = row.querySelector<HTMLElement>(".bases-td[data-property='file.name']");
    const filePath =
      fileCell?.querySelector<HTMLElement>("[data-href]")?.getAttribute("data-href") ?? null;
    if (!filePath) return;

    const file = this.app.vault.getMarkdownFiles().find((f) => f.path === filePath);
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    // Перехватываем клик — открываем наш редактор
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
