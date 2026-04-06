import { App, Modal, Notice, Setting, TFile, stringifyYaml } from "obsidian";
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

  constructor(app: App, manifestPath: string, data: ManifestData, onSaved: () => Promise<void>) {
    super(app);
    this.manifestPath = manifestPath;
    // Deep-clone so edits don't affect the live cache until Save
    this.data = JSON.parse(JSON.stringify(data)) as ManifestData;
    this.onSaved = onSaved;
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

    this.renderBasic(contentEl);
    this.renderTarget(contentEl);

    new Setting(contentEl).setName("Fields").setHeading();
    const fieldsEl = contentEl.createDiv("mv-fields-list");
    this.renderFields(fieldsEl);
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Add field").onClick(() => {
        this.data.fields ??= {};
        let name = "new_field";
        let n = 2;
        while (this.data.fields[name]) name = `new_field_${n++}`;
        this.data.fields[name] = { type: "text" };
        this.renderFields(fieldsEl);
      })
    );

    this.renderFormatting(contentEl);

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

  // ── Sections ──────────────────────────────────────────────────────────────

  private renderBasic(el: HTMLElement): void {
    new Setting(el).setName("Basic").setHeading();

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

    new Setting(el)
      .setName("Extends")
      .setDesc("Parent schema folder path (e.g. schemas/base).")
      .addText((t) => {
        t.inputEl.setAttribute("placeholder", "Schemas/base");
        t.setValue(this.data.extends ?? "").onChange((v) => {
          this.data.extends = v || undefined;
        });
      });
  }

  private renderTarget(el: HTMLElement): void {
    new Setting(el).setName("Target").setHeading();

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

    new Setting(el)
      .setName("Enforce folder")
      .setDesc("Auto-move notes outside the target folder on validation.")
      .addToggle((t) =>
        t.setValue(this.data.enforce_folder ?? false).onChange((v) => {
          this.data.enforce_folder = v || undefined;
        })
      );
  }

  private renderFormatting(el: HTMLElement): void {
    new Setting(el).setName("Formatting").setHeading();

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
        this.renderOptionsFields(body, field, update);
        break;
      case "text":
        this.renderTextFields(body, field, update);
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
