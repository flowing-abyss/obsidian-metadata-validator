import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { ManifestField, ResolvedSchema, ValidationResult } from "../types";
import { ValidationEngine } from "../validation/engine";
import { PickerModal } from "./picker-modal";

export class ContextMenuModal extends Modal {
  private readonly file: TFile;
  private readonly schema: ResolvedSchema;
  private readonly engine: ValidationEngine;
  private readonly getManifestFields:
    | ((path: string) => Record<string, ManifestField> | undefined)
    | null;
  private readonly openSchemaEditor: ((manifestPath: string) => void) | null;

  /** Persist optional-section expand state across refreshes */
  private optionalExpanded = false;

  constructor(
    app: App,
    file: TFile,
    schema: ResolvedSchema,
    getManifestFields?: (path: string) => Record<string, ManifestField> | undefined,
    openSchemaEditor?: (manifestPath: string) => void
  ) {
    super(app);
    this.file = file;
    this.schema = schema;
    this.engine = new ValidationEngine(app);
    this.getManifestFields = getManifestFields ?? null;
    this.openSchemaEditor = openSchemaEditor ?? null;
  }

  async onOpen(): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    delete frontmatter["position"];
    const results = await this.engine.validate(this.file, frontmatter, this.schema);
    this.render(frontmatter, this.buildResultMap(results));
  }

  private buildResultMap(results: ValidationResult[]): Map<string, ValidationResult[]> {
    const map = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = map.get(r.field) ?? [];
      existing.push(r);
      map.set(r.field, existing);
    }
    return map;
  }

  private render(
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mv-context-modal");

    contentEl.createEl("h3", { text: `Edit properties \u2014 ${this.file.basename}` });

    const entries = Object.entries(this.schema.fields).filter(([, def]) => !def.hidden);
    const required = entries.filter(([, def]) => def.required === true);
    const optional = entries.filter(([, def]) => def.required !== true);

    // Required fields section
    if (required.length > 0) {
      const section = contentEl.createDiv("mv-context-section");
      section.createEl("p", { text: "Required fields", cls: "mv-context-section-header" });
      for (const [key, def] of required) {
        this.renderFieldRow(section, key, def, frontmatter, resultMap);
      }
    }

    // Optional fields section (collapsible — state persisted)
    if (optional.length > 0) {
      const wrapper = contentEl.createDiv("mv-context-section");
      const header = wrapper.createDiv("mv-collapsible-header");
      const chevron = header.createEl("span", {
        cls: "mv-collapsible-chevron",
        text: this.optionalExpanded ? "\u25BE" : "\u203A",
      });
      header.createEl("span", {
        text: `Optional fields (${String(optional.length)})`,
        cls: "mv-collapsible-title",
      });
      const body = wrapper.createDiv("mv-collapsible-body");
      if (!this.optionalExpanded) body.addClass("mv-collapsible-body--collapsed");

      header.addEventListener("click", () => {
        const wasCollapsed = body.hasClass("mv-collapsible-body--collapsed");
        this.optionalExpanded = wasCollapsed;
        chevron.textContent = wasCollapsed ? "\u25BE" : "\u203A";
        body.toggleClass("mv-collapsible-body--collapsed", !wasCollapsed);
      });

      for (const [key, def] of optional) {
        this.renderFieldRow(body, key, def, frontmatter, resultMap);
      }
    }

    // Footer: schema chain with hover-highlight
    this.renderFooter(contentEl, resultMap);
  }

  private renderFieldRow(
    container: HTMLElement,
    fieldKey: string,
    fieldDef: ManifestField,
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const row = container.createDiv("mv-field-row");
    // Store field key for footer hover-highlight
    row.setAttribute("data-mv-field", fieldKey);

    // Label column — just the display name
    const labelEl = row.createDiv("mv-field-label");
    labelEl.createEl("span", { text: fieldDef.label ?? fieldKey, cls: "mv-field-label-text" });

    // Error icon column (between label and value)
    const errors = (resultMap.get(fieldKey) ?? []).filter((r) => !r.autoFixed);
    const errEl = row.createDiv("mv-field-err");
    if (errors.length > 0) {
      errEl.textContent = "\u26A0";
      errEl.title = errors.map((e) => e.message).join("\n");
    }

    // Value / editor column
    const valueEl = row.createDiv("mv-field-value");
    this.renderEditor(valueEl, fieldKey, fieldDef, frontmatter);
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
      const fixedDisplay =
        fieldDef.fixed === null
          ? ""
          : typeof fieldDef.fixed === "string" ||
              typeof fieldDef.fixed === "number" ||
              typeof fieldDef.fixed === "boolean"
            ? String(fieldDef.fixed)
            : "";
      container.createEl("span", { text: `Fixed: ${fixedDisplay}`, cls: "mv-field-fixed" });
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
          this.saveField(fieldKey, input.value || null);
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
        if (fieldDef.min !== undefined) input.setAttribute("min", String(fieldDef.min));
        if (fieldDef.max !== undefined) input.setAttribute("max", String(fieldDef.max));
        if (fieldDef.min !== undefined || fieldDef.max !== undefined) {
          const minText = fieldDef.min !== undefined ? String(fieldDef.min) : "\u2026";
          const maxText = fieldDef.max !== undefined ? String(fieldDef.max) : "\u2026";
          input.setAttribute("placeholder", `${minText}\u2013${maxText}`);
        }
        input.addEventListener("change", () => {
          const num = parseFloat(input.value);
          this.saveField(fieldKey, isNaN(num) ? null : num);
        });
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
        this.renderListChips(container, fieldKey, currentValue);
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
    const values = Array.isArray(currentValue)
      ? (currentValue as unknown[]).map((v) => this.toStr(v))
      : currentValue !== undefined && currentValue !== null
        ? [this.toStr(currentValue)]
        : [];

    // "Change" button comes first
    const editBtn = container.createEl("button", { text: "Change", cls: "mv-chip-edit" });
    editBtn.addEventListener("click", () => {
      this.openPicker(fieldKey, fieldDef, currentValue);
    });

    if (values.length === 0) {
      container.createEl("span", { text: "None", cls: "mv-field-empty" });
      return;
    }

    for (const raw of values) {
      const name = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").replace(/\|.*$/, "");
      if (isLink) {
        const link = container.createEl("a", { cls: "mv-wikilink", text: name });
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
  }

  /** List type: chips for each value + inline add/remove editing */
  private renderListChips(container: HTMLElement, fieldKey: string, currentValue: unknown): void {
    const values: string[] = Array.isArray(currentValue)
      ? (currentValue as unknown[]).map((v) => this.toStr(v)).filter(Boolean)
      : [];

    const chipsEl = container.createDiv("mv-list-chips");

    const saveList = (items: string[]) => {
      this.saveField(fieldKey, items.length > 0 ? items : null);
    };

    const refresh = (items: string[]) => {
      chipsEl.empty();
      items.forEach((val, idx) => {
        const chip = chipsEl.createEl("span", { cls: "mv-chip mv-chip--removable" });
        chip.createEl("span", { text: val });
        const rem = chip.createEl("span", { text: "\u00D7", cls: "mv-chip-remove" });
        rem.addEventListener("click", () => {
          const updated = items.filter((_, i) => i !== idx);
          saveList(updated);
          refresh(updated);
        });
      });

      const addInput = chipsEl.createEl("input", { type: "text", cls: "mv-list-add-input" });
      addInput.setAttribute("placeholder", "+");
      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const val = addInput.value.trim().replace(/,$/, "");
          if (val) {
            const updated = [...items, val];
            saveList(updated);
            refresh(updated);
          }
        }
      });
      addInput.addEventListener("blur", () => {
        const val = addInput.value.trim();
        if (val) {
          const updated = [...items, val];
          saveList(updated);
          refresh(updated);
        }
      });
    };

    refresh(values);
  }

  private openPicker(fieldKey: string, fieldDef: ManifestField, currentValue: unknown): void {
    new PickerModal(this.app, fieldKey, fieldDef, currentValue, this.schema, this.file).open();
  }

  /**
   * Determine whether a field is own / inherited / overrides in the inheritance chain.
   * Used by tests and by the footer hover-highlight feature.
   */
  fieldOrigin(fieldKey: string): "own" | "inherited" | "overrides" {
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

  private saveField(fieldKey: string, value: unknown): void {
    void this.app.fileManager
      .processFrontMatter(this.file, (fm: Record<string, unknown>) => {
        if (value === null || value === undefined) {
          delete fm[fieldKey];
        } else {
          fm[fieldKey] = value;
        }
      })
      .then(() => {
        void this.refreshView();
      });
  }

  private async refreshView(): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    delete frontmatter["position"];
    const results = await this.engine.validate(this.file, frontmatter, this.schema);
    this.render(frontmatter, this.buildResultMap(results));
  }

  private toStr(v: unknown): string {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  }

  /**
   * Footer shows the inheritance chain. Hovering each schema name highlights
   * which fields come from it via data attributes.
   */
  private renderFooter(container: HTMLElement, resultMap: Map<string, ValidationResult[]>): void {
    const footer = container.createDiv("mv-context-footer");
    const chain = this.schema.inheritanceChain;

    if (chain.length <= 1) {
      footer.createEl("span", { text: `Schema: ${this.schema.name}` });
      return;
    }

    footer.createEl("span", { text: "Schema: ", cls: "mv-footer-label" });

    chain
      .slice()
      .reverse()
      .forEach((manifestPath, i) => {
        // Extract a friendly name from the path
        const parts = manifestPath.split("/");
        const name = parts.length >= 2 ? (parts[parts.length - 2] ?? manifestPath) : manifestPath;

        const schemaSpan = footer.createEl("span", {
          text: name,
          cls: "mv-footer-schema-name",
        });
        schemaSpan.setAttribute("data-mv-chain-path", manifestPath);

        // Click: open schema editor for this manifest
        if (this.openSchemaEditor) {
          const openFn = this.openSchemaEditor;
          schemaSpan.addEventListener("click", () => {
            this.close();
            openFn(manifestPath);
          });
        }

        // Hover: highlight fields that originate from this schema
        schemaSpan.addEventListener("mouseenter", () => {
          if (!this.getManifestFields) return;
          const fieldsFromThis = this.getManifestFields(manifestPath);
          if (!fieldsFromThis) return;
          const fieldKeys = new Set(Object.keys(fieldsFromThis));
          container.querySelectorAll<HTMLElement>("[data-mv-field]").forEach((row) => {
            const k = row.getAttribute("data-mv-field") ?? "";
            row.toggleClass("mv-field-row--highlighted", fieldKeys.has(k));
          });
        });
        schemaSpan.addEventListener("mouseleave", () => {
          container
            .querySelectorAll<HTMLElement>(".mv-field-row--highlighted")
            .forEach((r) => r.removeClass("mv-field-row--highlighted"));
        });

        if (i < chain.length - 1) {
          footer.createEl("span", { text: " \u2190 ", cls: "mv-footer-arrow" });
        }
      });

    // Error count in footer
    let totalErrors = 0;
    resultMap.forEach((rs) => {
      totalErrors += rs.filter((r) => !r.autoFixed && r.severity === "error").length;
    });
    if (totalErrors > 0) {
      footer.createEl("span", {
        text: ` · ${totalErrors} error${totalErrors > 1 ? "s" : ""}`,
        cls: "mv-footer-errors",
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
