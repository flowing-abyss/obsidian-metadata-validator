import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { FieldOption, FieldSource, ManifestField, ResolvedSchema } from "../types";
import { resolveSource } from "../schema/source-resolver";

export class PickerModal extends Modal {
  private readonly fieldKey: string;
  private readonly field: ManifestField;
  private readonly schema: ResolvedSchema;
  private readonly file: TFile;
  private readonly onSaved: ((value: unknown) => void) | null;
  private options: FieldOption[] = [];
  // Mutable selection state — normalised values (no [[]])
  private selected: Set<string> = new Set();
  // For multi-select: defer save to onClose to avoid concurrent processFrontMatter calls
  private dirtyMulti = false;

  constructor(
    app: App,
    fieldKey: string,
    field: ManifestField,
    currentValue: unknown,
    schema: ResolvedSchema,
    file: TFile,
    onSaved?: (value: unknown) => void
  ) {
    super(app);
    this.fieldKey = fieldKey;
    this.field = field;
    this.schema = schema;
    this.file = file;
    this.onSaved = onSaved ?? null;
    this.initSelected(currentValue);
  }

  private initSelected(currentValue: unknown): void {
    if (Array.isArray(currentValue)) {
      for (const v of currentValue as unknown[]) {
        const n = this.normalise(v);
        if (n) this.selected.add(n);
      }
    } else {
      const n = this.normalise(currentValue);
      if (n) this.selected.add(n);
    }
  }

  async onOpen(): Promise<void> {
    this.options = await this.loadOptions();
    this.render();
  }

  private async loadOptions(): Promise<FieldOption[]> {
    if (Array.isArray(this.field.options)) {
      return this.field.options;
    }
    if (this.field.source) {
      return resolveSource(this.field.source, this.app, this.file);
    }
    if (this.field.options && !Array.isArray(this.field.options)) {
      const src = (this.field.options as { source: FieldSource }).source;
      if (src) return resolveSource(src, this.app, this.file);
    }
    return [];
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mv-picker-modal");

    const header = contentEl.createDiv("mv-picker-header");
    header.createEl("strong", { text: this.fieldKey });
    header.createEl("span", {
      text: ` · ${this.field.type}${this.field.required === true ? " · required" : ""}`,
      cls: "mv-picker-meta",
    });

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "mv-picker-search",
    });
    search.setAttribute("placeholder", "Search...");

    const listEl = contentEl.createDiv("mv-picker-list");
    this.renderOptions(listEl, this.options, search.value);

    search.addEventListener("input", () => {
      this.renderOptions(listEl, this.options, search.value);
    });

    const footer = contentEl.createDiv("mv-picker-footer");
    footer.createEl("span", { text: `Manifest: ${this.schema.manifestPath}` });
    if (this.schema.inheritanceChain.length > 1) {
      footer.createEl("br");
      footer.createEl("span", {
        text: `Inherits: ${this.schema.inheritanceChain.slice(0, -1).join(" → ")}`,
      });
    }
  }

  private get isMulti(): boolean {
    return (
      this.field.type === "multiselect" ||
      this.field.type === "multilink" ||
      this.field.type === "list"
    );
  }

  private get isLink(): boolean {
    return this.field.type === "link" || this.field.type === "multilink";
  }

  /** Strip [[...]] so stored "[[man]]" compares equal to option value "man". */
  private normalise(v: unknown): string {
    if (v === undefined || v === null || v === "") return "";
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return "";
    return String(v).trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  }

  private sortedOptions(options: FieldOption[], query: string): FieldOption[] {
    const q = query.toLowerCase();
    const filtered = q
      ? options.filter(
          (o) => o.value.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q)
        )
      : options;
    // Single-pass partition — avoids iterating filtered twice
    const sel: FieldOption[] = [];
    const unsel: FieldOption[] = [];
    for (const o of filtered) {
      if (this.selected.has(o.value)) sel.push(o);
      else unsel.push(o);
    }
    unsel.sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value));
    return [...sel, ...unsel];
  }

  private renderOptions(listEl: HTMLElement, options: FieldOption[], query: string): void {
    listEl.empty();

    const sorted = this.sortedOptions(options, query);

    if (sorted.length === 0) {
      listEl.createEl("p", { text: "No options available.", cls: "mv-picker-empty" });
      return;
    }

    for (const opt of sorted) {
      const isSelected = this.selected.has(opt.value);

      const item = listEl.createDiv({
        cls: isSelected ? "mv-picker-option is-selected" : "mv-picker-option",
      });

      item.createEl("span", { text: opt.label ?? opt.value });
      if (opt.label && opt.label !== opt.value) {
        item.createEl("span", { text: opt.value, cls: "mv-picker-value-hint" });
      }

      item.addEventListener("click", () => {
        if (this.isMulti) {
          // Toggle selection — save deferred to onClose to avoid concurrent saves
          if (this.selected.has(opt.value)) {
            this.selected.delete(opt.value);
          } else {
            this.selected.add(opt.value);
          }
          this.dirtyMulti = true;
          this.renderOptions(listEl, options, query);
        } else {
          // Single select: save and close immediately
          this.selected.clear();
          this.selected.add(opt.value);
          this.dirtyMulti = false;
          this.persistSelection();
          this.close();
        }
      });
    }
  }

  private persistSelection(): void {
    const key = this.fieldKey;
    let savedValue: unknown;

    if (this.isMulti) {
      savedValue = Array.from(this.selected).map((v) => (this.isLink ? `[[${v}]]` : v));
    } else {
      const val = Array.from(this.selected)[0];
      savedValue = val !== undefined ? (this.isLink ? `[[${val}]]` : val) : null;
    }

    void this.app.fileManager
      .processFrontMatter(this.file, (fm: Record<string, unknown>) => {
        fm[key] = savedValue;
      })
      .then(() => {
        this.onSaved?.(savedValue);
      });
  }

  onClose(): void {
    // For multi-select: flush accumulated selection on close (single save, no races)
    if (this.dirtyMulti) {
      this.dirtyMulti = false;
      this.persistSelection();
    }
    this.contentEl.empty();
  }
}
