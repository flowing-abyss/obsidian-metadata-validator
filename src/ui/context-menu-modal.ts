import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { ManifestField, ResolvedSchema, ValidationResult } from "../types";
import { ValidationEngine } from "../validation/engine";
import { PickerModal } from "./picker-modal";

type FieldOrigin = "own" | "inherited" | "overrides";

export class ContextMenuModal extends Modal {
  private readonly file: TFile;
  private readonly schema: ResolvedSchema;
  private readonly engine: ValidationEngine;
  private readonly getManifestFields:
    | ((path: string) => Record<string, ManifestField> | undefined)
    | null;

  constructor(
    app: App,
    file: TFile,
    schema: ResolvedSchema,
    getManifestFields?: (path: string) => Record<string, ManifestField> | undefined
  ) {
    super(app);
    this.file = file;
    this.schema = schema;
    this.engine = new ValidationEngine(app);
    this.getManifestFields = getManifestFields ?? null;
  }

  async onOpen(): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    delete frontmatter["position"];
    const results = await this.engine.validate(this.file, frontmatter, this.schema);

    const resultMap = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = resultMap.get(r.field) ?? [];
      existing.push(r);
      resultMap.set(r.field, existing);
    }

    this.render(frontmatter, resultMap);
  }

  private fieldOrigin(fieldKey: string): FieldOrigin {
    const chain = this.schema.inheritanceChain;
    const currentPath = chain[chain.length - 1];
    const parentPaths = chain.slice(0, -1);

    const inParents = parentPaths.some(
      (p) => this.getManifestFields?.(p)?.[fieldKey] !== undefined
    );
    const inCurrent = this.getManifestFields?.(currentPath ?? "")?.[fieldKey] !== undefined;

    if (inCurrent && inParents) return "overrides";
    if (!inCurrent && inParents) return "inherited";
    return "own";
  }

  private render(
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mv-context-modal");

    contentEl.createEl("h3", { text: `Edit properties \u2014 ${this.file.basename}` });

    const entries = Object.entries(this.schema.fields);
    const required = entries.filter(([, def]) => def.required === true);
    const optional = entries.filter(([, def]) => def.required !== true);

    // Required fields section
    if (required.length > 0) {
      const section = contentEl.createDiv();
      section.createEl("h4", { text: "Required fields", cls: "mv-context-section-header" });
      for (const [key, def] of required) {
        this.renderFieldRow(section, key, def, frontmatter, resultMap);
      }
    }

    // Optional fields section (collapsible)
    if (optional.length > 0) {
      const wrapper = contentEl.createDiv();
      const header = wrapper.createDiv("mv-collapsible-header");
      const chevron = header.createEl("span", {
        cls: "mv-collapsible-chevron",
        text: "\u203A",
      });
      header.createEl("span", {
        text: `Optional fields (${String(optional.length)})`,
        cls: "mv-collapsible-title",
      });
      const body = wrapper.createDiv("mv-collapsible-body");
      body.addClass("mv-collapsible-body--collapsed");

      header.addEventListener("click", () => {
        const wasCollapsed = body.hasClass("mv-collapsible-body--collapsed");
        chevron.textContent = wasCollapsed ? "\u25BE" : "\u203A";
        body.toggleClass("mv-collapsible-body--collapsed", !wasCollapsed);
      });

      for (const [key, def] of optional) {
        this.renderFieldRow(body, key, def, frontmatter, resultMap);
      }
    }

    // Footer: schema chain
    this.renderFooter(contentEl);
  }

  private renderFieldRow(
    container: HTMLElement,
    fieldKey: string,
    fieldDef: ManifestField,
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const row = container.createDiv("mv-field-row");

    // Label column
    const labelEl = row.createDiv("mv-field-label");
    labelEl.createEl("span", { text: fieldDef.label ?? fieldKey });

    // Inheritance badge
    if (this.getManifestFields && this.schema.inheritanceChain.length > 1) {
      const origin = this.fieldOrigin(fieldKey);
      if (origin === "inherited") {
        labelEl.createEl("span", { text: "(inherited)", cls: "mv-field-badge" });
      } else if (origin === "overrides") {
        labelEl.createEl("span", { text: "(overrides)", cls: "mv-field-badge" });
      }
    }

    // Value / editor column
    const valueEl = row.createDiv("mv-field-value");
    this.renderEditor(valueEl, fieldKey, fieldDef, frontmatter);

    // Error icon column
    const errors = (resultMap.get(fieldKey) ?? []).filter((r) => !r.autoFixed);
    if (errors.length > 0) {
      const errEl = row.createDiv("mv-field-err");
      errEl.textContent = "\u26A0";
      errEl.title = errors.map((e) => e.message).join("\n");
    }
  }

  private renderEditor(
    container: HTMLElement,
    fieldKey: string,
    fieldDef: ManifestField,
    frontmatter: Record<string, unknown>
  ): void {
    const currentValue = frontmatter[fieldKey];

    // Fixed fields: read-only
    if (fieldDef.fixed !== undefined) {
      container.createEl("span", {
        text: `Fixed: ${fieldDef.fixed === undefined || fieldDef.fixed === null ? "" : typeof fieldDef.fixed === "string" || typeof fieldDef.fixed === "number" || typeof fieldDef.fixed === "boolean" ? String(fieldDef.fixed) : ""}`,
        cls: "mv-field-fixed",
      });
      return;
    }

    switch (fieldDef.type) {
      case "text":
      case "url": {
        const input = container.createEl("input", {
          type: fieldDef.type === "url" ? "url" : "text",
          value: typeof currentValue === "string" ? currentValue : "",
        });
        input.setAttribute("placeholder", `Enter ${fieldDef.type}...`);
        input.addEventListener("change", () => {
          this.saveField(fieldKey, input.value);
        });
        break;
      }

      case "number": {
        const input = container.createEl("input", {
          type: "number",
          value:
            typeof currentValue === "number"
              ? String(currentValue)
              : typeof currentValue === "string"
                ? currentValue
                : "",
        });
        input.setAttribute("placeholder", "Enter number...");
        if (fieldDef.min !== undefined) input.setAttribute("min", String(fieldDef.min));
        if (fieldDef.max !== undefined) input.setAttribute("max", String(fieldDef.max));
        input.addEventListener("change", () => {
          const num = parseFloat(input.value);
          this.saveField(fieldKey, isNaN(num) ? null : num);
        });
        if (fieldDef.min !== undefined || fieldDef.max !== undefined) {
          const minText = fieldDef.min !== undefined ? String(fieldDef.min) : "\u2026";
          const maxText = fieldDef.max !== undefined ? String(fieldDef.max) : "\u2026";
          container.createEl("span", {
            text: `Range: ${minText}\u2013${maxText}`,
            cls: "mv-field-range-hint",
          });
        }
        break;
      }

      case "boolean": {
        const input = container.createEl("input", { type: "checkbox" });
        if (currentValue === true) input.checked = true;
        input.addEventListener("change", () => {
          this.saveField(fieldKey, input.checked);
        });
        break;
      }

      case "date": {
        const input = container.createEl("input", { type: "date" });
        if (typeof currentValue === "string") input.value = currentValue;
        input.addEventListener("change", () => {
          this.saveField(fieldKey, input.value || null);
        });
        break;
      }

      case "select":
      case "multiselect": {
        this.renderChips(container, fieldKey, fieldDef, currentValue, false);
        break;
      }

      case "link":
      case "multilink": {
        this.renderChips(container, fieldKey, fieldDef, currentValue, true);
        break;
      }

      case "list": {
        this.renderListEditor(container, fieldKey, currentValue);
        break;
      }
    }
  }

  private renderChips(
    container: HTMLElement,
    fieldKey: string,
    fieldDef: ManifestField,
    currentValue: unknown,
    isLink: boolean
  ): void {
    const toStr = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return "";
    };
    const values = Array.isArray(currentValue)
      ? (currentValue as unknown[]).map(toStr)
      : currentValue !== undefined && currentValue !== null
        ? [toStr(currentValue)]
        : [];

    if (values.length === 0) {
      const emptySpan = container.createEl("span", {
        text: "None selected",
        cls: "mv-field-fixed",
      });
      emptySpan.addEventListener("click", () => {
        this.openPicker(fieldKey, fieldDef, currentValue);
      });
      return;
    }

    for (const raw of values) {
      const name = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
      if (isLink) {
        const link = container.createEl("a", {
          cls: "mv-wikilink",
          text: name,
        });
        link.setAttribute("data-href", name);
        link.addEventListener("click", (e) => {
          e.preventDefault();
          void this.app.workspace.openLinkText(name, this.file.path, false);
        });
      } else {
        const chip = container.createEl("span", { text: name, cls: "mv-chip" });
        chip.addEventListener("click", () => {
          this.openPicker(fieldKey, fieldDef, currentValue);
        });
      }
    }

    const editBtn = container.createEl("button", { text: "Change", cls: "mv-chip-edit" });
    editBtn.addEventListener("click", () => {
      this.openPicker(fieldKey, fieldDef, currentValue);
    });
  }

  private openPicker(fieldKey: string, fieldDef: ManifestField, currentValue: unknown): void {
    new PickerModal(this.app, fieldKey, fieldDef, currentValue, this.schema, this.file).open();
    // Do NOT close the context menu modal
  }

  private renderListEditor(container: HTMLElement, fieldKey: string, currentValue: unknown): void {
    const listEl = container.createDiv("mv-list-editor");

    const toStr = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return "";
    };
    const values: string[] = Array.isArray(currentValue)
      ? (currentValue as unknown[]).map(toStr)
      : [];

    // Add an empty row at the end for new entries
    const rows = [...values, ""];

    const saveList = (): void => {
      const inputs = listEl.querySelectorAll("input");
      const newValues: string[] = [];
      inputs.forEach((inp) => {
        const val = inp.value.trim();
        if (val) {
          // Auto-quote markdown link patterns
          const quoted = this.quoteLinksIfNeeded(val);
          newValues.push(quoted);
        }
      });
      this.saveField(fieldKey, newValues.length > 0 ? newValues : null);
    };

    const addRow = (value: string, isLast: boolean): void => {
      const rowDiv = listEl.createDiv("mv-list-row");
      const input = rowDiv.createEl("input", { type: "text", value });
      input.setAttribute("placeholder", isLast ? "Add item..." : "");
      input.addEventListener("change", () => {
        saveList();
      });
      input.addEventListener("input", () => {
        if (input.value.trim() && input === listEl.lastElementChild?.querySelector("input")) {
          addRow("", false);
        }
      });
    };

    for (let i = 0; i < rows.length; i++) {
      addRow(rows[i] ?? "", i === rows.length - 1);
    }
  }

  private quoteLinksIfNeeded(value: string): string {
    // If value contains [[ ]] or [text](url) patterns, wrap in quotes
    if (/\[\[.*?\]\]/.test(value) || /\[.*?\]\(.*?\)/.test(value)) {
      // Only quote if not already quoted
      if (!value.startsWith('"') && !value.startsWith("'")) {
        return `"${value}"`;
      }
    }
    return value;
  }

  private saveField(fieldKey: string, value: unknown): void {
    void this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
      if (value === null || value === undefined) {
        delete fm[fieldKey];
      } else {
        fm[fieldKey] = value;
      }
    });
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv("mv-context-footer");
    const chain = this.schema.inheritanceChain;
    if (chain.length <= 1) {
      footer.createEl("span", { text: `Applied schema: ${this.schema.name}` });
    } else {
      // Build names from paths: extract folder name from each path
      const names = chain
        .map((p) => {
          const parts = p.split("/");
          // Path like "schemas/book/manifest.md" -> "book"
          return parts.length >= 2 ? (parts[parts.length - 2] ?? p) : p;
        })
        .reverse(); // current first, root last
      footer.createEl("span", {
        text: `Applied schema: ${names.join(" \u2190 ")}`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
