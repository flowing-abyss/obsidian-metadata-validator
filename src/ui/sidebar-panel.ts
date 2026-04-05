import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ValidationResult } from "../types";

export const SIDEBAR_PANEL_TYPE = "mv-sidebar-panel";

export class SidebarPanel extends ItemView {
  private results: ValidationResult[] = [];
  private fileName = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_PANEL_TYPE;
  }
  getDisplayText(): string {
    return "Metadata validator";
  }
  getIcon(): string {
    return "shield-check";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  update(fileName: string, results: ValidationResult[]): void {
    this.fileName = fileName;
    this.results = results;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h4", { text: this.fileName || "No file open" });

    const errors = this.results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = this.results.filter((r) => !r.autoFixed && r.severity === "warning");
    const autoFixed = this.results.filter((r) => r.autoFixed);

    if (this.results.length === 0) {
      contentEl.createEl("p", { text: "✓ all properties valid." });
      return;
    }

    for (const r of [...errors, ...warnings]) {
      const row = contentEl.createDiv("mv-sidebar-row");
      row.createEl("span", {
        text: r.severity === "error" ? "⚠ " : "ℹ ",
        cls: r.severity === "error" ? "mv-error" : "mv-warning",
      });
      row.createEl("strong", { text: r.field + ": " });
      row.createEl("span", { text: r.message });
    }

    if (autoFixed.length > 0) {
      contentEl.createDiv({
        text: `⚙ ${autoFixed.length} auto-fixed`,
        cls: "mv-sidebar-autofixed",
      });
    }

    contentEl.createDiv({
      text: `${errors.length} error(s) · ${warnings.length} warning(s)`,
      cls: "mv-sidebar-summary",
    });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
