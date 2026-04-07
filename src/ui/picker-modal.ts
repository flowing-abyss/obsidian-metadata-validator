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

  /**
   * Normalise a stored wikilink to a bare basename for comparison with option values.
   * Handles: plain text, [[name]], [[path/name]], [[path/name|alias]]
   */
  private normalise(v: unknown): string {
    if (v === undefined || v === null || v === "") return "";
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return "";
    let s = String(v).trim();
    if (s.startsWith("[[")) s = s.slice(2);
    if (s.endsWith("]]")) s = s.slice(0, -2);
    // Strip alias — keep the link target
    const pipe = s.indexOf("|");
    if (pipe !== -1) s = s.slice(0, pipe);
    // Strip folder path — keep only basename
    const slash = s.lastIndexOf("/");
    if (slash !== -1) s = s.slice(slash + 1);
    return s.trim();
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

  /**
   * Resolve a bare basename to a full-path wikilink [[path/to/name]] using
   * Obsidian's internal link index. Falls back to [[name]] if not found.
   * This keeps links consistent with how Obsidian natively stores them.
   */
  private toWikilink(basename: string): string {
    const resolved = this.app.metadataCache.getFirstLinkpathDest(basename, this.file.path);
    if (resolved) {
      const pathNoExt = resolved.path.replace(/\.md$/, "");
      return `[[${pathNoExt}]]`;
    }
    return `[[${basename}]]`;
  }

  private persistSelection(): void {
    const key = this.fieldKey;
    let savedValue: unknown;

    if (this.isMulti) {
      savedValue = Array.from(this.selected).map((v) => (this.isLink ? this.toWikilink(v) : v));
    } else {
      const val = Array.from(this.selected)[0];
      savedValue = val !== undefined ? (this.isLink ? this.toWikilink(val) : val) : null;
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
