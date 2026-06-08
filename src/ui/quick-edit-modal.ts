import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { ManifestField } from "../types";

/**
 * Compact single-field editor opened when clicking a type icon in the properties panel.
 * Handles date, number, text, url, and list types.
 * Boolean is toggled inline (no modal) — handled in decorator.ts.
 */
export class QuickEditModal extends Modal {
  private readonly file: TFile;
  private readonly fieldKey: string;
  private readonly fieldDef: ManifestField;
  private currentValue: unknown;

  constructor(
    app: App,
    file: TFile,
    fieldKey: string,
    fieldDef: ManifestField,
    currentValue: unknown
  ) {
    super(app);
    this.file = file;
    this.fieldKey = fieldKey;
    this.fieldDef = fieldDef;
    this.currentValue = currentValue;
    this.modalEl.addClass("mv-quick-edit-modal");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: this.fieldDef.label ?? this.fieldKey,
      cls: "mv-qe-title",
    });
    this.renderInput(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private save(value: unknown): void {
    void this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
      if (value === null || value === undefined) {
        delete fm[this.fieldKey];
      } else {
        fm[this.fieldKey] = value;
      }
    });
  }

  private renderInput(container: HTMLElement): void {
    switch (this.fieldDef.type) {
      case "number": {
        const numWrap = container.createDiv("mv-qe-number-row");
        const input = numWrap.createEl("input", { type: "number", cls: "mv-qe-input" });
        // Do not set min/max HTML attributes — the browser's native constraint
        // validation would block out-of-range values with a tooltip and could
        // intercept Enter before our keydown handler runs. Range validation is
        // handled by our own engine instead.
        if (typeof this.currentValue === "number") input.value = String(this.currentValue);
        if (this.fieldDef.min !== undefined || this.fieldDef.max !== undefined) {
          const minText = this.fieldDef.min !== undefined ? String(this.fieldDef.min) : "\u2026";
          const maxText = this.fieldDef.max !== undefined ? String(this.fieldDef.max) : "\u2026";
          numWrap.createSpan({
            text: `${minText}\u2013${maxText}`,
            cls: "mv-qe-range-hint",
          });
        }
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const n = parseFloat(input.value);
            this.save(isNaN(n) ? null : n);
            this.close();
          } else if (e.key === "Escape") {
            this.close();
          }
        });
        input.addEventListener("blur", () => {
          const n = parseFloat(input.value);
          this.save(isNaN(n) ? null : n);
          this.close();
        });
        activeWindow.setTimeout(() => input.focus(), 0);
        break;
      }

      case "date": {
        const input = container.createEl("input", { type: "date", cls: "mv-qe-input" });
        if (typeof this.currentValue === "string") input.value = this.currentValue;
        input.addEventListener("change", () => {
          this.save(input.value || null);
          this.close();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Escape") this.close();
        });
        activeWindow.setTimeout(() => {
          input.focus();
          input.showPicker?.();
        }, 0);
        break;
      }

      case "text":
      case "url": {
        const input = container.createEl("input", {
          type: this.fieldDef.type === "url" ? "url" : "text",
          cls: "mv-qe-input",
        });
        if (typeof this.currentValue === "string") input.value = this.currentValue;
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.save(input.value.trim() || null);
            this.close();
          } else if (e.key === "Escape") {
            this.close();
          }
        });
        input.addEventListener("blur", () => {
          this.save(input.value.trim() || null);
          this.close();
        });
        activeWindow.setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
        break;
      }

      case "list": {
        this.renderListInput(container);
        break;
      }
    }
  }

  private renderListInput(container: HTMLElement): void {
    const items: string[] = Array.isArray(this.currentValue)
      ? (this.currentValue as unknown[])
          .map((v) => (typeof v === "string" ? v : String(v)))
          .filter(Boolean)
      : typeof this.currentValue === "string" && this.currentValue
        ? [this.currentValue]
        : [];

    const listEl = container.createDiv("mv-qe-list");

    const saveList = (newItems: string[]) => {
      this.currentValue = newItems.length > 0 ? newItems : null;
      this.save(this.currentValue);
    };

    const render = (curItems: string[]) => {
      listEl.empty();
      curItems.forEach((val, idx) => {
        const row = listEl.createDiv("mv-qe-list-row");
        const inp = row.createEl("input", { type: "text", value: val, cls: "mv-qe-list-input" });
        const del = row.createEl("button", {
          text: "\u00D7",
          cls: "mv-qe-list-del clickable-icon",
        });
        inp.addEventListener("change", () => {
          const updated = [...curItems];
          if (inp.value.trim()) {
            updated[idx] = inp.value.trim();
          } else {
            updated.splice(idx, 1);
          }
          const filtered = updated.filter(Boolean);
          saveList(filtered);
          render(filtered);
        });
        del.addEventListener("click", () => {
          const updated = curItems.filter((_, i) => i !== idx);
          saveList(updated);
          render(updated);
        });
      });

      // Add row
      const addRow = listEl.createDiv("mv-qe-list-row");
      const addInp = addRow.createEl("input", {
        type: "text",
        cls: "mv-qe-list-input mv-qe-list-add",
      });
      addInp.setAttribute("placeholder", "Add item\u2026");
      addInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && addInp.value.trim()) {
          const updated = [...curItems, addInp.value.trim()];
          saveList(updated);
          render(updated);
        }
      });
      addInp.addEventListener("blur", () => {
        if (addInp.value.trim()) {
          const updated = [...curItems, addInp.value.trim()];
          saveList(updated);
          render(updated);
        }
      });
    };

    render(items);
  }
}
