import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { FieldOption, FieldSource, ManifestField, ResolvedSchema } from "../types";
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
      placeholder: "Search...",
      cls: "mv-picker-search",
    });

    const listEl = contentEl.createDiv("mv-picker-list");
    this.renderOptions(listEl, this.options);

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      const filtered = this.options.filter(
        (o) => o.value.toLowerCase().includes(q) || (o.label ?? "").toLowerCase().includes(q)
      );
      this.renderOptions(listEl, filtered);
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

  /** Strip [[...]] so stored "[[man]]" compares equal to option value "man". */
  private normalise(v: unknown): string {
    return String(v).trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  }

  private renderOptions(listEl: HTMLElement, options: FieldOption[]): void {
    listEl.empty();

    if (options.length === 0) {
      listEl.createEl("p", { text: "No options available.", cls: "mv-picker-empty" });
      return;
    }

    for (const opt of options) {
      const isSelected = Array.isArray(this.currentValue)
        ? (this.currentValue as unknown[]).some((v) => this.normalise(v) === opt.value)
        : this.normalise(this.currentValue) === opt.value;

      const item = listEl.createDiv({
        cls: isSelected ? "mv-picker-option is-selected" : "mv-picker-option",
      });

      item.createEl("span", { text: opt.label ?? opt.value });
      if (opt.label && opt.label !== opt.value) {
        item.createEl("span", { text: opt.value, cls: "mv-picker-value-hint" });
      }

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
    const isLink = this.field.type === "link" || this.field.type === "multilink";
    // Wrap link values in [[...]] so Obsidian treats them as internal links
    const formatted = isLink ? `[[${value}]]` : value;

    const key = this.fieldKey;
    void this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
      if (isMulti) {
        const current = Array.isArray(fm[key]) ? (fm[key] as string[]) : [];
        // Compare by normalised basename to avoid duplicates with/without [[]]
        if (current.some((v) => this.normalise(v) === value)) {
          fm[key] = current.filter((v) => this.normalise(v) !== value);
        } else {
          fm[key] = [...current, formatted];
        }
      } else {
        fm[key] = formatted;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
