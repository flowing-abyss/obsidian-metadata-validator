import { App, Modal, Notice, Setting, TFile, stringifyYaml } from "obsidian";
import type { ManifestCache } from "../manifest/cache";
import type { FieldOption, FieldType, ManifestData, ManifestField, ManifestTarget } from "../types";

const FIELD_TYPES: FieldType[] = [
  "text",
  "select",
  "multiselect",
  "number",
  "link",
  "multilink",
  "date",
  "boolean",
  "url",
  "list",
];

/** Safely convert an unknown value to a display string. */
function toStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export class SchemaEditorModal extends Modal {
  private data: ManifestData;
  private readonly manifestPath: string;
  private readonly onSaved: () => Promise<void>;
  private readonly cache?: ManifestCache;

  constructor(
    app: App,
    manifestPath: string,
    data: ManifestData,
    onSaved: () => Promise<void>,
    cache?: ManifestCache
  ) {
    super(app);
    this.manifestPath = manifestPath;
    // Deep-clone so edits don't affect the live cache until Save
    this.data = JSON.parse(JSON.stringify(data)) as ManifestData;
    this.onSaved = onSaved;
    this.cache = cache;
    this.modalEl.addClass("mv-schema-editor-modal");
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── Main render ───────────────────────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", {
      text: `Schema editor — ${this.data.name ?? this.manifestPath}`,
      cls: "mv-editor-title",
    });

    this.renderCollapsibleSection(contentEl, "Basic", (body) => this.renderBasic(body));
    this.renderCollapsibleSection(contentEl, "Target", (body) => this.renderTarget(body));
    this.renderCollapsibleSection(contentEl, "Fields", (body) => {
      const fieldsEl = body.createDiv("mv-fields-list");
      this.renderFields(fieldsEl);
      new Setting(body).addButton((btn) =>
        btn.setButtonText("Add field").onClick(() => {
          this.data.fields ??= {};
          let name = "new_field";
          let n = 2;
          while (this.data.fields[name]) name = `new_field_${n++}`;
          this.data.fields[name] = { type: "text" };
          this.renderFields(fieldsEl);
        })
      );
    });
    this.renderCollapsibleSection(contentEl, "Formatting", (body) => this.renderFormatting(body));

    const footer = new Setting(contentEl);
    footer
      .addButton((btn) =>
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(() => void this.save())
      )
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .setDesc(`File: ${this.manifestPath}`);
  }

  // ── Collapsible section helper ────────────────────────────────────────────

  private renderCollapsibleSection(
    el: HTMLElement,
    title: string,
    renderFn: (body: HTMLElement) => void
  ): void {
    const wrapper = el.createDiv("mv-collapsible");
    const header = wrapper.createDiv("mv-collapsible-header");
    const chevron = header.createEl("span", { cls: "mv-collapsible-chevron", text: "›" });
    header.createEl("span", { text: title, cls: "mv-collapsible-title" });
    const body = wrapper.createDiv("mv-collapsible-body");
    body.addClass("mv-collapsible-body--collapsed");
    let rendered = false;
    header.addEventListener("click", () => {
      const wasCollapsed = body.hasClass("mv-collapsible-body--collapsed");
      if (wasCollapsed && !rendered) {
        renderFn(body);
        rendered = true;
      }
      body.toggleClass("mv-collapsible-body--collapsed", !wasCollapsed);
      chevron.textContent = wasCollapsed ? "⌄" : "›";
    });
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private renderBasic(el: HTMLElement): void {
    new Setting(el).setName("Name").addText((t) =>
      t.setValue(this.data.name ?? "").onChange((v) => {
        this.data.name = v || undefined;
      })
    );

    new Setting(el)
      .setName("Priority")
      .setDesc("Higher value wins when multiple schemas match.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("mv-input-number-sm");
        t.setValue(String(this.data.priority ?? 0)).onChange((v) => {
          this.data.priority = Number(v) || 0;
        });
      });

    // Auto-detected parent from folder nesting (computed before Extends setting so we can wire them)
    let bannerWrapper: HTMLElement | null = null;
    if (this.cache) {
      const folder = this.manifestPath.replace(/\/manifest\.md$/, "");
      const parentFolder = folder.split("/").slice(0, -1).join("/");
      const autoParent = this.cache.getByFolder(parentFolder);
      if (autoParent) {
        bannerWrapper = el.createDiv();
        bannerWrapper.toggleClass("mv-hidden", !!this.data.extends);
        new Setting(bannerWrapper)
          .setName("Auto-detected parent")
          .setDesc(
            `Inheriting from ${autoParent.path} (folder nesting). Set "Extends" above to override.`
          )
          .addExtraButton((btn) =>
            btn.setIcon("info").setTooltip("Parent detected from folder structure")
          );
      }
    }

    new Setting(el)
      .setName("Extends")
      .setDesc("Parent schema folder path (e.g. schemas/base).")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Schemas/base");
        t.setValue(this.data.extends ?? "").onChange((v) => {
          this.data.extends = v || undefined;
          if (bannerWrapper) bannerWrapper.toggleClass("mv-hidden", !!v);
        });
      });

    const enforceVal = this.data.enforce_folder;
    let enforceToggleOn = !!enforceVal;

    const enforceSetting = new Setting(el)
      .setName("Enforce folder")
      .setDesc("Auto-move notes matching this schema into the target folder.");

    let enforcePathInput: HTMLInputElement | null = null;

    const pathContainer = el.createDiv();
    if (!enforceToggleOn) pathContainer.addClass("mv-hidden");

    new Setting(pathContainer)
      .setName("Destination folder")
      .setDesc("Folder path to move notes into. Leave empty to use target.folder.")
      .addText((t) => {
        enforcePathInput = t.inputEl;
        t.inputEl.setAttribute("placeholder", "Sources/books");
        t.setValue(typeof enforceVal === "string" ? enforceVal : "");
        t.onChange((v) => {
          this.data.enforce_folder = v.trim() || true;
        });
      });

    enforceSetting.addToggle((t) =>
      t.setValue(enforceToggleOn).onChange((v) => {
        enforceToggleOn = v;
        if (v) {
          pathContainer.removeClass("mv-hidden");
          this.data.enforce_folder = enforcePathInput?.value.trim() || true;
        } else {
          pathContainer.addClass("mv-hidden");
          this.data.enforce_folder = undefined;
        }
      })
    );
  }

  private renderTarget(el: HTMLElement): void {
    new Setting(el)
      .setName("Folder")
      .setDesc("Apply to notes whose path starts with this folder.")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Sources/");
        t.setValue(this.data.target?.folder ?? "").onChange((v) => {
          this.data.target = { ...this.data.target, folder: v || undefined };
        });
      });

    new Setting(el)
      .setName("Tag")
      .setDesc("Apply to notes with this tag.")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Article");
        t.setValue(this.data.target?.tag ?? "").onChange((v) => {
          this.data.target = { ...this.data.target, tag: v || undefined };
        });
      });

    new Setting(el)
      .setName("Match mode")
      .setDesc("How folder and tag conditions are combined.")
      .addDropdown((d) =>
        d
          .addOption("AND", "All conditions must match")
          .addOption("OR", "Any condition matches")
          .setValue(this.data.target?.op ?? "AND")
          .onChange((v) => {
            this.data.target = { ...this.data.target, op: v as "AND" | "OR" };
          })
      );
  }

  private renderFormatting(el: HTMLElement): void {
    new Setting(el)
      .setName("Property order")
      .setDesc("Comma-separated field names in the desired display order.")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Status, author, tags, rating");
        t.setValue((this.data.formatting?.property_order ?? []).join(", ")).onChange((v) => {
          const order = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          this.data.formatting = { property_order: order.length ? order : undefined };
        });
      });
  }

  // ── Fields ────────────────────────────────────────────────────────────────

  private renderFields(fieldsEl: HTMLElement): void {
    fieldsEl.empty();
    for (const [key, field] of Object.entries(this.data.fields ?? {})) {
      this.renderFieldCard(fieldsEl, key, field);
    }
  }

  private renderFieldCard(container: HTMLElement, key: string, field: ManifestField): void {
    const card = container.createDiv("mv-field-card");

    // ── Drag-and-drop ─────────────────────────────────────────
    card.setAttribute("draggable", "true");
    card.setAttribute("data-field-key", key);

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", key);
      card.addClass("mv-dragging");
    });
    card.addEventListener("dragend", () => {
      card.removeClass("mv-dragging");
    });
    let enterCount = 0;
    card.addEventListener("dragenter", (e) => {
      e.preventDefault();
      enterCount++;
      card.addClass("mv-drag-over");
    });
    card.addEventListener("dragleave", () => {
      if (--enterCount === 0) card.removeClass("mv-drag-over");
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault(); // keep this for drop to work
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.removeClass("mv-drag-over");
      const fromKey = e.dataTransfer?.getData("text/plain");
      if (fromKey && fromKey !== key) {
        this.reorderFields(fromKey, key);
        this.renderFields(container);
      }
    });

    // ── Card header ───────────────────────────────────────────
    const header = card.createDiv("mv-field-card-header");

    const keyInput = header.createEl("input", { type: "text", cls: "mv-field-key-input" });
    keyInput.value = key;
    keyInput.setAttribute("placeholder", "Field name");

    const typeSelect = header.createEl("select", { cls: "mv-field-type-select" });
    for (const t of FIELD_TYPES) {
      const opt = typeSelect.createEl("option", { value: t, text: t });
      if (field.type === t) opt.selected = true;
    }

    const removeBtn = header.createEl("button", { cls: "mv-field-remove-btn clickable-icon" });
    removeBtn.setAttribute("aria-label", "Remove field");
    removeBtn.textContent = "✕";

    // ── Card body ─────────────────────────────────────────────
    const body = card.createDiv("mv-field-card-body");
    this.renderFieldBody(body, key, field);

    // ── Event handlers ────────────────────────────────────────
    const renameField = () => {
      const newKey = keyInput.value.trim().replace(/\s+/g, "_");
      if (!newKey || newKey === key) {
        keyInput.value = key;
        return;
      }
      const fields = this.data.fields ?? {};
      if (fields[newKey]) {
        new Notice(`Field "${newKey}" already exists.`);
        keyInput.value = key;
        return;
      }
      fields[newKey] = fields[key] as ManifestField;
      delete fields[key];
      this.data.fields = fields;
      this.renderFields(container);
    };
    keyInput.addEventListener("blur", renameField);
    keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        keyInput.blur();
      }
    });

    typeSelect.addEventListener("change", () => {
      const fields = this.data.fields ?? {};
      const existing = fields[key];
      const updated: ManifestField = {
        type: typeSelect.value as FieldType,
        label: existing?.label,
        required: existing?.required,
      };
      fields[key] = updated;
      this.data.fields = fields;
      body.empty();
      this.renderFieldBody(body, key, updated);
    });

    removeBtn.addEventListener("click", () => {
      delete (this.data.fields ?? {})[key];
      card.remove();
    });
  }

  private reorderFields(fromKey: string, toKey: string): void {
    const fields = this.data.fields ?? {};
    const keys = Object.keys(fields);
    const fromIdx = keys.indexOf(fromKey);
    const toIdx = keys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;
    keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, fromKey);
    const reordered: Record<string, (typeof fields)[string]> = {};
    for (const k of keys) reordered[k] = fields[k]!;
    this.data.fields = reordered;
    this.data.formatting = { ...this.data.formatting, property_order: keys };
  }

  private renderFieldBody(body: HTMLElement, key: string, field: ManifestField): void {
    const update = (patch: Partial<ManifestField>) => {
      const fields = this.data.fields ?? {};
      fields[key] = { ...fields[key], ...patch } as ManifestField;
    };

    // ── Common settings ───────────────────────────────────────
    new Setting(body)
      .setName("Label")
      .setDesc("Human-readable display name (optional).")
      .addText((t) =>
        t.setValue(field.label ?? "").onChange((v) => update({ label: v || undefined }))
      );

    new Setting(body)
      .setName("Required")
      .addToggle((t) =>
        t.setValue(field.required ?? false).onChange((v) => update({ required: v || undefined }))
      );

    // ── Type-specific ─────────────────────────────────────────
    switch (field.type) {
      case "number":
        this.renderNumberFields(body, field, update);
        break;
      case "link":
      case "multilink":
        this.renderSourceFields(body, field, update);
        break;
      case "select":
      case "multiselect":
        this.renderOptionsFields(body, key, field, update);
        break;
      case "text":
        this.renderTextFields(body, field, update);
        break;
      case "date":
        this.renderDateFields(body, field, update);
        break;
      default:
        this.renderDefaultField(body, field, update);
    }
  }

  // ── Per-type sub-renderers ────────────────────────────────────────────────

  private renderNumberFields(
    body: HTMLElement,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body).setName("Range").setHeading();

    new Setting(body).setName("Min").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.addClass("mv-input-number-md");
      t.setValue(field.min !== undefined ? String(field.min) : "").onChange((v) =>
        update({ min: v !== "" ? Number(v) : undefined })
      );
    });

    new Setting(body).setName("Max").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.addClass("mv-input-number-md");
      t.setValue(field.max !== undefined ? String(field.max) : "").onChange((v) =>
        update({ max: v !== "" ? Number(v) : undefined })
      );
    });

    this.renderDefaultField(body, field, update);
  }

  private renderSourceFields(
    body: HTMLElement,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body).setName("Source").setHeading();

    new Setting(body)
      .setName("Folder")
      .setDesc("Only show notes from this folder.")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "People/");
        t.setValue(field.source?.folder ?? "").onChange((v) =>
          update({ source: { ...field.source, folder: v || undefined } })
        );
      });

    new Setting(body)
      .setName("Tag")
      .setDesc("Only show notes with this tag.")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Person");
        t.setValue(field.source?.tag ?? "").onChange((v) =>
          update({ source: { ...field.source, tag: v || undefined } })
        );
      });

    new Setting(body)
      .setName("Validate existence")
      .setDesc("Show an error if the linked note does not exist.")
      .addToggle((t) =>
        t.setValue(field.validate_exists ?? true).onChange((v) => update({ validate_exists: v }))
      );
  }

  private renderOptionsFields(
    body: HTMLElement,
    fieldName: string,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body).setName("Options").setHeading();

    const options: FieldOption[] = Array.isArray(field.options)
      ? (JSON.parse(JSON.stringify(field.options)) as FieldOption[])
      : [];

    const listEl = body.createDiv("mv-options-list");
    const save = () => update({ options: options.length ? [...options] : undefined });

    const renderList = () => {
      listEl.empty();
      options.forEach((opt, idx) => {
        const row = listEl.createDiv("mv-option-row");
        row.setAttribute("draggable", "true");
        row.setAttribute("data-option-index", String(idx));

        row.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData("text/plain", String(idx));
          row.addClass("mv-dragging");
        });
        row.addEventListener("dragend", () => {
          row.removeClass("mv-dragging");
        });
        let rowEnterCount = 0;
        row.addEventListener("dragenter", (e) => {
          e.preventDefault();
          rowEnterCount++;
          row.addClass("mv-drag-over");
        });
        row.addEventListener("dragleave", () => {
          if (--rowEnterCount === 0) row.removeClass("mv-drag-over");
        });
        row.addEventListener("dragover", (e) => {
          e.preventDefault(); // keep this for drop to work
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.removeClass("mv-drag-over");
          const fromIdxStr = e.dataTransfer?.getData("text/plain");
          if (fromIdxStr === undefined || fromIdxStr === String(idx)) return;
          const fromIdx = parseInt(fromIdxStr, 10);
          if (isNaN(fromIdx)) return;
          this.reorderOptions(fieldName, fromIdx, idx);
          // Sync local options array from data
          const updated = this.data.fields?.[fieldName]?.options;
          if (Array.isArray(updated)) {
            options.length = 0;
            options.push(...updated);
          }
          save();
          renderList();
        });

        const valInput = row.createEl("input", {
          type: "text",
          cls: "mv-option-input mv-option-value",
        });
        valInput.value = opt.value;
        valInput.setAttribute("placeholder", "Value");

        row.createEl("span", { text: "→", cls: "mv-option-arrow" });

        const labelInput = row.createEl("input", {
          type: "text",
          cls: "mv-option-input mv-option-label",
        });
        labelInput.value = opt.label ?? "";
        labelInput.setAttribute("placeholder", "Label (optional)");

        const delBtn = row.createEl("button", { text: "✕", cls: "mv-option-del clickable-icon" });

        const commit = () => {
          options[idx] = {
            value: valInput.value.trim(),
            label: labelInput.value.trim() || undefined,
          };
          save();
        };
        valInput.addEventListener("change", commit);
        labelInput.addEventListener("change", commit);
        delBtn.addEventListener("click", () => {
          options.splice(idx, 1);
          save();
          renderList();
        });
      });
    };
    renderList();

    new Setting(body).addButton((btn) =>
      btn.setButtonText("Add option").onClick(() => {
        options.push({ value: "" });
        save();
        renderList();
      })
    );

    this.renderDefaultField(body, field, update);
  }

  private reorderOptions(fieldName: string, fromIdx: number, toIdx: number): void {
    const field = this.data.fields?.[fieldName];
    if (!field || !Array.isArray(field.options)) return;
    const opts = [...field.options];
    const [moved] = opts.splice(fromIdx, 1);
    if (moved) opts.splice(toIdx, 0, moved);
    field.options = opts;
  }

  private renderDateFields(
    body: HTMLElement,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body)
      .setName("Format")
      .setDesc("Expected date format, e.g. YYYY-MM-DD or DD/MM/YYYY")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "YYYY-MM-DD"); // eslint-disable-line obsidianmd/ui/sentence-case
        t.setValue(field.format ?? "").onChange((v) => update({ format: v || undefined }));
      });

    this.renderDefaultField(body, field, update);
  }

  private renderTextFields(
    body: HTMLElement,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body)
      .setName("Fixed value")
      .setDesc("Always overwrite with this value on save.")
      .addText((t) =>
        t.setValue(toStr(field.fixed)).onChange((v) => update({ fixed: v || undefined }))
      );

    this.renderDefaultField(body, field, update);
  }

  private renderDefaultField(
    body: HTMLElement,
    field: ManifestField,
    update: (p: Partial<ManifestField>) => void
  ): void {
    new Setting(body)
      .setName("Default value")
      .setDesc("Inserted automatically when the field is missing.")
      .addText((t) =>
        t.setValue(toStr(field.default)).onChange((v) => update({ default: v || undefined }))
      );
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  private async save(): Promise<void> {
    const yaml = stringifyYaml(this.buildCleanData());
    const file = this.app.vault.getAbstractFileByPath(this.manifestPath);
    let body = "";
    if (file instanceof TFile) {
      const raw = await this.app.vault.read(file);
      const afterFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      body = afterFrontmatter.trim();
    }
    const content = `---\n${yaml}---\n${body ? `\n${body}\n` : ""}`;

    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(this.manifestPath, content);
    }

    new Notice(`Schema saved: ${this.data.name ?? this.manifestPath}`);
    await this.onSaved();
    this.close();
  }

  private buildCleanData(): Record<string, unknown> {
    const d = this.data;
    const out: Record<string, unknown> = {};

    if (d.name) out.name = d.name;
    if (d.priority) out.priority = d.priority;
    if (d.extends) out.extends = d.extends;
    if (d.enforce_folder) out.enforce_folder = d.enforce_folder;

    const target: ManifestTarget = {};
    if (d.target?.folder) target.folder = d.target.folder;
    if (d.target?.tag) target.tag = d.target.tag;
    if (d.target?.property) target.property = d.target.property;
    if (d.target?.op && d.target.op !== "AND") target.op = d.target.op;
    if (Object.keys(target).length) out.target = target;

    const fields: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(d.fields ?? {})) {
      if (!k.trim()) continue;
      const fOut: Record<string, unknown> = { type: f.type };
      if (f.label) fOut.label = f.label;
      if (f.required) fOut.required = f.required;
      if (f.default !== undefined && f.default !== "") fOut.default = f.default;
      if (f.fixed !== undefined && f.fixed !== "") fOut.fixed = f.fixed;
      if (f.min !== undefined) fOut.min = f.min;
      if (f.max !== undefined) fOut.max = f.max;
      if (f.sort) fOut.sort = f.sort;
      if (f.validate_exists !== undefined) fOut.validate_exists = f.validate_exists;
      if (Array.isArray(f.options) && f.options.length) fOut.options = f.options;
      if (f.source) {
        const src: Record<string, unknown> = {};
        if (f.source.folder) src.folder = f.source.folder;
        if (f.source.tag) src.tag = f.source.tag;
        if (f.source.js) src.js = f.source.js;
        if (Object.keys(src).length) fOut.source = src;
      }
      if (f.validate?.js) fOut.validate = { js: f.validate.js };
      fields[k] = fOut;
    }
    if (Object.keys(fields).length) out.fields = fields;

    if (d.formatting?.property_order?.length) {
      out.formatting = { property_order: d.formatting.property_order };
    }

    return out;
  }
}
