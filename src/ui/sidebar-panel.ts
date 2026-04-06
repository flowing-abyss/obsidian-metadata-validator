import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ValidationResult } from "../types";

export const SIDEBAR_PANEL_TYPE = "mv-sidebar-panel";

export class SidebarPanel extends ItemView {
  private results: ValidationResult[] = [];
  private fileName = "";
  private onOpenCallback: (() => void) | null = null;
  private readonly onScanVault: (() => Promise<void>) | null;

  constructor(leaf: WorkspaceLeaf, onOpenCallback?: () => void, onScanVault?: () => Promise<void>) {
    super(leaf);
    this.onOpenCallback = onOpenCallback ?? null;
    this.onScanVault = onScanVault ?? null;
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
    // Trigger validation of the currently active file so the panel isn't empty on open
    this.onOpenCallback?.();
  }

  update(fileName: string, results: ValidationResult[]): void {
    this.fileName = fileName;
    this.results = results;
    this.render();
  }

  showScanSummary(count: number): void {
    const { contentEl } = this;
    // Append a summary line without clearing the current results
    const existing = contentEl.querySelector(".mv-scan-summary");
    if (existing) existing.remove();
    contentEl.createDiv({
      text: `Scanned ${count} file(s)`,
      cls: "mv-sidebar-summary mv-scan-summary",
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Scan vault button
    const scanBtn = contentEl.createEl("button", {
      text: "Scan vault",
      cls: "mv-scan-btn",
    });
    scanBtn.addEventListener("click", () => {
      if (this.onScanVault) {
        scanBtn.disabled = true;
        scanBtn.textContent = "Scanning...";
        void this.onScanVault().then(() => {
          scanBtn.disabled = false;
          scanBtn.textContent = "Scan vault";
        });
      }
    });

    if (!this.fileName) {
      contentEl.createEl("p", {
        text: "Open a note to see validation results.",
        cls: "mv-sidebar-empty",
      });
      return;
    }

    contentEl.createEl("h4", { text: this.fileName });

    const errors = this.results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = this.results.filter((r) => !r.autoFixed && r.severity === "warning");
    const autoFixed = this.results.filter((r) => r.autoFixed);

    if (errors.length === 0 && warnings.length === 0) {
      const ok = contentEl.createDiv("mv-sidebar-ok");
      ok.createEl("span", { text: "✓ " });
      ok.appendText(
        autoFixed.length > 0 ? `all valid — ${autoFixed.length} auto-fixed` : "all properties valid"
      );
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
