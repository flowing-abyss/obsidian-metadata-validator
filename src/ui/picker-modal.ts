import type { TFile } from "obsidian";
import { App, Modal } from "obsidian";
import { resolveSource } from "../schema/source-resolver";
import type { FieldOption, ManifestField, ResolvedSchema } from "../types";

type SelectionMode = "select" | "multiselect";

interface OptionGroupView {
  key: string;
  label: string;
  type: SelectionMode;
  options: FieldOption[];
}

export class PickerModal extends Modal {
  private readonly fieldKey: string;
  private readonly field: ManifestField;
  private readonly schema: ResolvedSchema;
  private readonly file: TFile;
  private readonly onSaved: ((value: unknown) => void) | null;
  private readonly enableJs: boolean;
  private options: FieldOption[] = [];
  // Mutable selection state — normalised values (no [[]])
  private selected: Set<string> = new Set();
  // For multi-select: defer save to onClose to avoid concurrent processFrontMatter calls
  private dirtyMulti = false;
  // Keyboard navigation: index of the currently focused option row
  private focusedIdx = 0;

  constructor(
    app: App,
    fieldKey: string,
    field: ManifestField,
    currentValue: unknown,
    schema: ResolvedSchema,
    file: TFile,
    onSaved?: (value: unknown) => void,
    enableJs = false
  ) {
    super(app);
    this.fieldKey = fieldKey;
    this.field = field;
    this.schema = schema;
    this.file = file;
    this.onSaved = onSaved ?? null;
    this.enableJs = enableJs;
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
      return resolveSource(this.field.source, this.app, this.file, this.enableJs);
    }
    if (this.field.options && !Array.isArray(this.field.options)) {
      const src = this.field.options.source;
      if (src) return resolveSource(src, this.app, this.file, this.enableJs);
    }
    return [];
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mv-picker-modal");

    const header = contentEl.createDiv("mv-picker-header");
    header.createEl("strong", { text: this.fieldKey });
    header.createSpan({
      text: ` · ${this.field.type}${this.field.required === true ? " · required" : ""}`,
      cls: "mv-picker-meta",
    });

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "mv-picker-search",
    });
    search.setAttribute("placeholder", "Search...");

    const listEl = contentEl.createDiv("mv-picker-list");
    this.focusedIdx = 0;
    this.renderOptions(listEl, this.options, search.value);

    search.addEventListener("input", () => {
      // Reset focus to first item on every search change
      this.focusedIdx = 0;
      this.renderOptions(listEl, this.options, search.value);
    });

    search.addEventListener("keydown", (e) => {
      const items = Array.from(listEl.querySelectorAll<HTMLElement>(".mv-picker-option"));
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.focusedIdx = (this.focusedIdx + 1) % items.length;
        this.applyFocus(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.focusedIdx = (this.focusedIdx - 1 + items.length) % items.length;
        this.applyFocus(items);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = items[this.focusedIdx];
        if (target) target.click();
      }
    });

    search.focus();
  }

  private applyFocus(items: HTMLElement[]): void {
    items.forEach((el) => el.removeClass("is-focused"));
    const target = items[this.focusedIdx];
    if (target) {
      target.addClass("is-focused");
      target.scrollIntoView({ block: "nearest" });
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

  /**
   * Normalise a stored wikilink to a bare basename for comparison with option values.
   * Handles: plain text, [[name]], [[path/name]], [[path/name|alias]]
   */
  private normalise(v: unknown): string {
    if (v === undefined || v === null || v === "") return "";
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return "";
    let s = String(v).trim();
    const wasWikilink = s.startsWith("[[");
    if (wasWikilink) s = s.slice(2);
    if (s.endsWith("]]")) s = s.slice(0, -2);
    // Strip alias — keep the link target
    const pipe = s.indexOf("|");
    if (pipe !== -1) s = s.slice(0, pipe);
    // Strip folder path — only for wikilinks; plain values (e.g. tags with slashes) are kept as-is
    if (wasWikilink) {
      const slash = s.lastIndexOf("/");
      if (slash !== -1) s = s.slice(slash + 1);
    }
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

  private defaultSelectionMode(): SelectionMode {
    return this.isMulti ? "multiselect" : "select";
  }

  private getOptionSelectionMode(opt: FieldOption): SelectionMode {
    return opt.type === "select" ? "select" : "multiselect";
  }

  private getOptionGroupKey(opt: FieldOption): string {
    const group = opt.group?.trim();
    return group && group.length > 0 ? group : "__default__";
  }

  private sortGroupOptions(opts: FieldOption[]): FieldOption[] {
    const sel: FieldOption[] = [];
    const unsel: FieldOption[] = [];
    for (const o of opts) {
      if (this.selected.has(o.value)) sel.push(o);
      else unsel.push(o);
    }
    unsel.sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value));
    return [...sel, ...unsel];
  }

  private groupedOptions(options: FieldOption[], query: string): OptionGroupView[] {
    const defaultType = this.defaultSelectionMode();
    const q = query.toLowerCase();
    const groups = new Map<string, OptionGroupView>();

    for (const raw of options) {
      const label = raw.label ?? raw.value;
      if (
        q &&
        !raw.value.toLowerCase().includes(q) &&
        !label.toLowerCase().includes(q) &&
        !(raw.group ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }

      const key = this.getOptionGroupKey(raw);
      const groupLabel = raw.group?.trim() ?? "";
      const mode = raw.type === "select" || raw.type === "multiselect" ? raw.type : defaultType;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: groupLabel,
          type: mode,
          options: [],
        });
      }

      const group = groups.get(key);
      if (!group) continue;
      group.options.push({
        ...raw,
        type: mode,
      });
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      options: this.sortGroupOptions(group.options),
    }));
  }

  private toggleOption(opt: FieldOption): void {
    if (!this.isMulti) {
      this.selected.clear();
      this.selected.add(opt.value);
      this.dirtyMulti = false;
      return;
    }

    const mode = this.getOptionSelectionMode(opt);
    if (mode === "select") {
      const groupKey = this.getOptionGroupKey(opt);
      for (const candidate of this.options) {
        if (candidate.value === opt.value) continue;
        if (this.getOptionGroupKey(candidate) !== groupKey) continue;
        if (this.getOptionSelectionMode(candidate) !== "select") continue;
        this.selected.delete(candidate.value);
      }
    }

    if (this.selected.has(opt.value)) {
      this.selected.delete(opt.value);
    } else {
      this.selected.add(opt.value);
    }
    this.dirtyMulti = true;
  }

  private renderOptions(listEl: HTMLElement, options: FieldOption[], query: string): void {
    listEl.empty();

    const groups = this.groupedOptions(options, query);
    if (groups.length === 0) {
      listEl.createEl("p", { text: "No options available.", cls: "mv-picker-empty" });
      return;
    }

    const hasNamedGroups = groups.some((g) => g.label.length > 0);
    const addOptionRow = (container: HTMLElement, opt: FieldOption) => {
      const isSelected = this.selected.has(opt.value);

      const item = container.createDiv({
        cls: isSelected ? "mv-picker-option is-selected" : "mv-picker-option",
      });

      item.createSpan({ text: opt.label ?? opt.value });
      if (opt.label && opt.label !== opt.value) {
        item.createSpan({ text: opt.value, cls: "mv-picker-value-hint" });
      }

      item.addEventListener("click", () => {
        this.toggleOption(opt);
        if (this.isMulti) {
          this.renderOptions(listEl, options, query);
        } else {
          this.persistSelection();
          this.close();
        }
      });
    };

    if (!hasNamedGroups && groups.length === 1) {
      for (const opt of groups[0]?.options ?? []) addOptionRow(listEl, opt);
    } else {
      for (const group of groups) {
        if (group.options.length === 0) continue;
        const section = listEl.createDiv("mv-picker-group");
        const header = section.createDiv("mv-picker-group-header");
        header.createSpan({
          text: group.label || "Options",
          cls: "mv-picker-group-title",
        });
        header.createSpan({
          text: group.type,
          cls: "mv-picker-group-type",
        });

        const groupList = section.createDiv("mv-picker-group-options");
        for (const opt of group.options) addOptionRow(groupList, opt);
      }
    }

    // Restore keyboard focus after every render (including re-renders after toggle)
    const items = Array.from(listEl.querySelectorAll<HTMLElement>(".mv-picker-option"));
    this.focusedIdx = Math.min(this.focusedIdx, items.length - 1);
    this.applyFocus(items);
  }

  /**
   * Generate a wikilink for a selected option value, respecting the user's
   * Obsidian link format settings (shortest path / absolute path / relative path).
   * Uses generateMarkdownLink so Obsidian decides when a full path is needed
   * (e.g. when two files share the same basename).
   * Always outputs [[...]] format since frontmatter uses wikilinks.
   */
  private toWikilink(basename: string): string {
    const resolved = this.app.metadataCache.getFirstLinkpathDest(basename, this.file.path);
    if (!resolved) return `[[${basename}]]`;

    const generated = this.app.fileManager.generateMarkdownLink(resolved, this.file.path);

    // generateMarkdownLink returns [[path]] or [[path|alias]] when wikilinks are on,
    // or [text](path.md) when markdown links are on.
    // For frontmatter we always want [[path]] without alias.
    const wikiMatch = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(generated);
    if (wikiMatch) return `[[${wikiMatch[1]}]]`;

    // Markdown link fallback — extract path, strip .md
    const mdMatch = /^\[[^\]]*\]\(([^)]+)\)$/.exec(generated);
    if (mdMatch) {
      const path = decodeURIComponent(mdMatch[1] ?? "").replace(/\.md$/, "");
      return `[[${path}]]`;
    }

    return `[[${resolved.path.replace(/\.md$/, "")}]]`;
  }

  private persistSelection(): void {
    const key = this.fieldKey;

    void this.app.fileManager
      .processFrontMatter(this.file, (fm: Record<string, unknown>) => {
        const isStrict = this.field.strict !== false;
        let savedValue: unknown;

        if (this.isMulti) {
          if (!isStrict) {
            const optionValues = new Set(this.options.map((o) => o.value));
            // managed = only the selected values that are actually in the options list
            // (initSelected adds ALL current values to `selected`, including unmanaged ones)
            const managed = Array.from(this.selected)
              .filter((v) => optionValues.has(v))
              .map((v) => (this.isLink ? this.toWikilink(v) : v));
            // unmanaged = existing field values not in the options list (preserved as-is)
            const existing = Array.isArray(fm[key]) ? (fm[key] as unknown[]) : [];
            const unmanaged = existing.filter((v) => {
              const n = this.normalise(v);
              return n !== "" && !optionValues.has(n);
            });
            savedValue = [...managed, ...unmanaged];
          } else {
            savedValue = Array.from(this.selected).map((v) =>
              this.isLink ? this.toWikilink(v) : v
            );
          }
        } else {
          const val = Array.from(this.selected)[0];
          savedValue = val !== undefined ? (this.isLink ? this.toWikilink(val) : val) : null;
        }

        fm[key] = savedValue;
      })
      .then(() => {
        const savedValue = this.isMulti
          ? Array.from(this.selected).map((v) => (this.isLink ? this.toWikilink(v) : v))
          : (Array.from(this.selected)[0] ?? null);
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
