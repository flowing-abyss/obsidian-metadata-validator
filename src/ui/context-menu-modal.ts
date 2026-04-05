import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { ResolvedSchema, ValidationResult } from "../types";
import { ValidationEngine } from "../validation/engine";
import { PickerModal } from "./picker-modal";

export class ContextMenuModal extends Modal {
  private readonly file: TFile;
  private readonly schema: ResolvedSchema;
  private readonly engine: ValidationEngine;

  constructor(app: App, file: TFile, schema: ResolvedSchema) {
    super(app);
    this.file = file;
    this.schema = schema;
    this.engine = new ValidationEngine(app);
  }

  async onOpen(): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const frontmatter = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    const results = await this.engine.validate(this.file, frontmatter, this.schema);

    const resultMap = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = resultMap.get(r.field) ?? [];
      existing.push(r);
      resultMap.set(r.field, existing);
    }

    this.render(frontmatter, resultMap);
  }

  private render(
    frontmatter: Record<string, unknown>,
    resultMap: Map<string, ValidationResult[]>
  ): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Edit properties — ${this.file.basename}` });

    for (const [fieldKey, fieldDef] of Object.entries(this.schema.fields)) {
      const row = contentEl.createDiv("mv-context-row");

      row.createEl("span", { text: fieldKey, cls: "mv-context-name" });

      const val = frontmatter[fieldKey];
      const valText = (() => {
        if (val === undefined) return "—";
        if (Array.isArray(val)) return val.map((v) => String(v)).join(", ");
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean")
          return String(val);
        return "—";
      })();
      row.createEl("span", {
        text: valText,
        cls: "mv-context-value",
      });

      const errors = (resultMap.get(fieldKey) ?? []).filter((r) => !r.autoFixed);
      if (errors.length > 0) {
        const errIcon = row.createEl("span", { text: "⚠", cls: "mv-context-err-icon" });
        errIcon.title = errors.map((e) => e.message).join("\n");
      }

      const editBtn = row.createEl("button", { text: "Edit" });
      editBtn.addEventListener("click", () => {
        this.close();
        new PickerModal(
          this.app,
          fieldKey,
          fieldDef,
          frontmatter[fieldKey],
          this.schema,
          this.file
        ).open();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
