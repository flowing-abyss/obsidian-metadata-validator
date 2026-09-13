import { moment } from "../utils/dates";
import type { App, TFile } from "obsidian";
import type { FieldOption, PropertySuggestion } from "../types";

/** Draft selection and one atomic property write when leaving its editor. */
export class KeyboardPropertyDraft {
  private availableOptions: FieldOption[] = [];
  private originalLinks = new Map<string, string>();
  selected = new Set<string>();
  dirty = false;
  private removed = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly file: TFile,
    readonly property: PropertySuggestion,
    readonly value: unknown
  ) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const normalized = this.normalize(item);
      if (normalized) {
        this.selected.add(normalized);
        this.rememberLink(normalized, item);
      }
    }
  }

  get options(): FieldOption[] {
    return this.availableOptions;
  }

  set options(options: FieldOption[]) {
    this.availableOptions = options;
    if (!this.isLink) return;
    const selected = new Set<string>();
    for (const value of this.selected) {
      const key = this.selectionKey(value);
      selected.add(key);
      const original = this.originalLinks.get(value);
      if (original) this.originalLinks.set(key, original);
    }
    this.selected = selected;
  }

  private get isLink(): boolean {
    return this.property.field.type === "link" || this.property.field.type === "multilink";
  }

  get multiple(): boolean {
    return ["list", "multiselect", "multilink"].includes(this.property.field.type);
  }

  get freeList(): boolean {
    return this.multiple && !this.property.field.options && !this.property.field.source;
  }

  get scalar(): boolean {
    return (
      !this.multiple &&
      this.property.field.type !== "boolean" &&
      !this.property.field.options &&
      !this.property.field.source
    );
  }

  get choices(): FieldOption[] {
    const options = new Map(this.options.map((option) => [option.value, option]));
    for (const value of this.selected) {
      if (!options.has(value)) options.set(value, { value, label: value });
    }
    return Array.from(options.values());
  }

  toggle(option: FieldOption): void {
    const value = option.value;
    if (!this.multiple) {
      this.selected.clear();
      this.selected.add(value);
    } else if (this.selected.has(value)) {
      this.selected.delete(value);
      this.removed.add(value);
    } else {
      if (option.type === "select") {
        for (const other of this.options) {
          if (other.type === "select" && (other.group ?? "") === (option.group ?? "")) {
            this.selected.delete(other.value);
          }
        }
      }
      this.selected.add(value);
      this.removed.delete(value);
    }
    this.dirty = true;
  }

  add(value: string): void {
    const normalized = this.selectionKey(value);
    if (!normalized || this.selected.has(normalized)) return;
    this.selected.add(normalized);
    this.rememberLink(normalized, value);
    this.removed.delete(normalized);
    this.dirty = true;
  }

  clear(): void {
    for (const value of this.selected) this.removed.add(value);
    this.selected.clear();
    this.dirty = true;
  }

  private normalize(value: unknown): string {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      return "";
    const text = String(value).trim();
    if (!this.isLink || !text.startsWith("[[")) return text;
    return text.slice(2).replace(/\]\]$/, "").split("|")[0] ?? "";
  }

  private rememberLink(key: string, value: unknown): void {
    if (this.isLink && typeof value === "string" && /^\[\[.*\]\]$/.test(value.trim()))
      this.originalLinks.set(key, value.trim());
  }

  private linkIdentity(value: string): string {
    const normalized = this.normalize(value);
    const [path = "", ...subpath] = normalized.split("#");
    const target = this.app.metadataCache.getFirstLinkpathDest(path, this.file.path);
    return (
      (target?.path.replace(/\.md$/, "") ?? path.replace(/\.md$/, "")) +
      (subpath.length ? `#${subpath.join("#")}` : "")
    );
  }

  private selectionKey(value: unknown): string {
    const normalized = this.normalize(value);
    if (!this.isLink || !normalized) return normalized;
    const identity = this.linkIdentity(normalized);
    return (
      this.options.find((option) => this.linkIdentity(option.value) === identity)?.value ??
      normalized
    );
  }

  private stored(value: string): string | number | boolean {
    const type = this.property.field.type;
    if (type === "boolean") return value === "true";
    if (type === "number") {
      const number = Number(value);
      if (!value.trim() || !Number.isFinite(number)) throw new Error("Enter a valid number.");
      return number;
    }
    if (!this.isLink) return value;
    const original = this.originalLinks.get(value);
    if (original) return original;
    if (value.startsWith("[[") && value.endsWith("]]")) return value;
    const target = this.app.metadataCache.getFirstLinkpathDest(value, this.file.path);
    if (!target) return `[[${value}]]`;
    const generated = this.app.fileManager.generateMarkdownLink(target, this.file.path);
    const wiki = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(generated);
    if (wiki) return `[[${wiki[1]}]]`;
    const markdown = /^\[[^\]]*\]\(([^)]+)\)$/.exec(generated);
    return `[[${markdown ? decodeURIComponent(markdown[1] ?? "").replace(/\.md$/, "") : target.path.replace(/\.md$/, "")}]]`;
  }

  async save(text?: string): Promise<unknown> {
    const { key, field } = this.property;
    if (field.fixed !== undefined) throw new Error("This property has a fixed value.");
    let value: unknown;
    if (this.scalar) {
      const trimmed = text?.trim() ?? "";
      value = trimmed || null;
      if (
        trimmed &&
        field.type === "date" &&
        !moment(trimmed, field.format || "YYYY-MM-DD", true).isValid()
      ) {
        throw new Error(`Enter a valid date as ${field.format || "YYYY-MM-DD"}.`);
      }
      if (trimmed && field.type === "number") {
        value = Number(trimmed);
        if (!Number.isFinite(value)) throw new Error("Enter a valid number.");
      } else if (trimmed && field.type === "link") {
        value = trimmed.startsWith("[[") && trimmed.endsWith("]]") ? trimmed : this.stored(trimmed);
      }
    } else {
      const values = Array.from(this.selected, (item) => this.stored(item));
      value = this.multiple ? values : (values[0] ?? null);
    }
    await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
      if (this.multiple && !this.freeList && field.strict === false) {
        const managed = new Set(this.options.map((option) => option.value));
        const chosen = Array.from(this.selected)
          .filter((item) => managed.has(item))
          .map((item) => this.stored(item));
        const current = Array.isArray(fm[key]) ? (fm[key] as unknown[]) : [];
        value = [
          ...chosen,
          ...current.filter((item) => {
            const normalized = this.selectionKey(item);
            return normalized && !managed.has(normalized) && !this.removed.has(normalized);
          }),
        ];
      }
      if (value === null && !field.required) delete fm[key];
      else fm[key] = value;
    });
    this.dirty = false;
    return value;
  }
}
