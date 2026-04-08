import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ValidationResult } from "../types";

export const SIDEBAR_PANEL_TYPE = "mv-sidebar-panel";

interface VaultStats {
  total: number;
  errors: number;
  warnings: number;
  noSchema: number;
}

export class SidebarPanel extends ItemView {
  private results: ValidationResult[] = [];
  private fileName = "";
  private onOpenCallback: (() => void) | null = null;
  private readonly onScanVault: (() => Promise<void>) | null;
  private readonly onApplyAutoFixes: (() => Promise<void>) | null;
  private vaultStats: VaultStats | null = null;
  private isScanningVault = false;
  private isApplyingAutoFixes = false;

  constructor(
    leaf: WorkspaceLeaf,
    onOpenCallback?: () => void,
    onScanVault?: () => Promise<void>,
    onApplyAutoFixes?: () => Promise<void>
  ) {
    super(leaf);
    this.onOpenCallback = onOpenCallback ?? null;
    this.onScanVault = onScanVault ?? null;
    this.onApplyAutoFixes = onApplyAutoFixes ?? null;
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

  showVaultStats(stats: VaultStats): void {
    this.vaultStats = stats;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const actions = contentEl.createDiv("mv-sidebar-actions");

    const scanBtn = actions.createEl("button", {
      text: this.isScanningVault ? "Scanning..." : "Scan vault",
      cls: "mv-sidebar-action-btn mv-scan-btn",
    });
    scanBtn.disabled = this.isScanningVault || this.isApplyingAutoFixes || !this.onScanVault;
    scanBtn.addEventListener("click", () => {
      void this.runScanVault();
    });

    const autoFixBtn = actions.createEl("button", {
      text: this.isApplyingAutoFixes ? "Applying..." : "Apply auto-fixes",
      cls: "mv-sidebar-action-btn mv-autofix-btn",
    });
    autoFixBtn.disabled =
      this.isScanningVault || this.isApplyingAutoFixes || !this.onApplyAutoFixes;
    autoFixBtn.addEventListener("click", () => {
      void this.runApplyAutoFixes();
    });

    // ── Vault health summary (after scan) ─────────────────────
    if (this.vaultStats) {
      this.renderVaultStats(contentEl, this.vaultStats);
      contentEl.createEl("hr", { cls: "mv-sidebar-divider" });
    }

    // ── Current-file section ──────────────────────────────────
    if (!this.fileName) {
      contentEl.createEl("p", {
        text: "Open a note to see validation results.",
        cls: "mv-sidebar-empty",
      });
      return;
    }

    contentEl.createEl("h4", { text: this.fileName, cls: "mv-sidebar-filename" });

    const errors = this.results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = this.results.filter((r) => !r.autoFixed && r.severity === "warning");
    const autoFixed = this.results.filter((r) => r.autoFixed);

    if (errors.length === 0 && warnings.length === 0) {
      const ok = contentEl.createDiv("mv-sidebar-ok");
      ok.createEl("span", { text: "✓ " });
      ok.appendText(
        autoFixed.length > 0 ? `all valid — ${autoFixed.length} auto-fixed` : "all properties valid"
      );
      if (autoFixed.length > 0) return;
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

  private renderVaultStats(container: HTMLElement, stats: VaultStats): void {
    const section = container.createDiv("mv-vault-stats");
    section.createEl("h4", { text: "Vault health", cls: "mv-vault-stats-title" });

    const clean = stats.total - stats.errors - stats.warnings - stats.noSchema;
    const rows: Array<{ label: string; count: number; cls: string }> = [
      { label: "notes scanned", count: stats.total, cls: "" },
      { label: "with errors", count: stats.errors, cls: "mv-stat-errors" },
      { label: "with warnings", count: stats.warnings, cls: "mv-stat-warnings" },
      { label: "clean", count: clean, cls: "mv-stat-clean" },
      { label: "no schema", count: stats.noSchema, cls: "mv-stat-none" },
    ];

    for (const row of rows) {
      const rowEl = section.createDiv("mv-stat-row");
      rowEl.createEl("span", { text: String(row.count), cls: `mv-stat-count ${row.cls}` });
      rowEl.createEl("span", { text: " " + row.label, cls: "mv-stat-label" });
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async runScanVault(): Promise<void> {
    if (!this.onScanVault || this.isScanningVault || this.isApplyingAutoFixes) return;

    this.vaultStats = null;
    this.isScanningVault = true;
    this.render();

    try {
      await this.onScanVault();
    } finally {
      this.isScanningVault = false;
      this.render();
    }
  }

  private async runApplyAutoFixes(): Promise<void> {
    if (!this.onApplyAutoFixes || this.isApplyingAutoFixes || this.isScanningVault) return;

    this.isApplyingAutoFixes = true;
    this.render();

    try {
      await this.onApplyAutoFixes();
    } finally {
      this.isApplyingAutoFixes = false;
      this.render();
    }
  }
}
