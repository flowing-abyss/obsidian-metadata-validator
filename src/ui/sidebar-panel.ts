import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { ValidationResult } from "../types";

export const SIDEBAR_PANEL_TYPE = "mv-sidebar-panel";

export interface VaultStats {
  total: number;
  errors: number;
  warnings: number;
  noSchema: number;
}

export interface VaultIssueNote {
  filePath: string;
  fileName: string;
  manifestPath: string;
  manifestName: string;
  results: ValidationResult[];
}

export interface VaultScanReport {
  stats: VaultStats;
  reports: VaultIssueNote[];
  scannedAt: number;
}

export interface VaultScanProgress {
  processed: number;
  total: number;
}

interface VaultIssueGroup {
  manifestPath: string;
  manifestName: string;
  reports: VaultIssueNote[];
  errors: number;
  warnings: number;
}

export class SidebarPanel extends ItemView {
  private results: ValidationResult[] = [];
  private fileName = "";
  private onOpenCallback: (() => void) | null = null;
  private readonly onScanVault:
    | ((onProgress?: (progress: VaultScanProgress) => void) => Promise<void>)
    | null;
  private readonly onApplyAutoFixes: (() => Promise<void>) | null;
  private vaultScan: VaultScanReport | null = null;
  private isScanningVault = false;
  private isApplyingAutoFixes = false;
  private readonly groupExpanded = new Map<string, boolean>();

  constructor(
    leaf: WorkspaceLeaf,
    onOpenCallback?: () => void,
    onScanVault?: (onProgress?: (progress: VaultScanProgress) => void) => Promise<void>,
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

  showVaultScan(report: VaultScanReport): void {
    this.vaultScan = report;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const actions = contentEl.createDiv("mv-sidebar-actions");

    const copyBtn = actions.createEl("button", {
      text: "Copy issues to clipboard",
      cls: "mv-sidebar-action-btn mv-copy-btn",
    });
    copyBtn.disabled =
      this.isScanningVault ||
      this.isApplyingAutoFixes ||
      !this.vaultScan ||
      this.vaultScan.reports.length === 0;
    copyBtn.addEventListener("click", () => {
      void this.copyVaultIssuesToClipboard();
    });

    const scanBtn = actions.createEl("button", {
      text: this.isScanningVault ? "Scanning..." : "Scan vault",
      cls: `mv-sidebar-action-btn mv-scan-btn${this.isScanningVault ? " is-scanning" : ""}`,
    });
    scanBtn.disabled = this.isScanningVault || this.isApplyingAutoFixes || !this.onScanVault;
    scanBtn.addEventListener("click", () => {
      void this.runScanVault();
    });

    const autoFixBtn = actions.createEl("button", {
      text: this.isApplyingAutoFixes ? "Applying..." : "Auto-fix",
      cls: "mv-sidebar-action-btn mv-autofix-btn",
    });
    autoFixBtn.disabled =
      this.isScanningVault || this.isApplyingAutoFixes || !this.onApplyAutoFixes;
    autoFixBtn.addEventListener("click", () => {
      void this.runApplyAutoFixes();
    });

    if (this.isScanningVault) {
      const scanState = contentEl.createDiv("mv-sidebar-scan-state");
      scanState.createSpan({ cls: "mv-sidebar-scan-dot" });
      scanState.createSpan({ text: "Vault scan in progress..." });
    }

    if (this.vaultScan) {
      this.renderVaultStats(contentEl, this.vaultScan);
      contentEl.createEl("hr", { cls: "mv-sidebar-divider" });
    }

    this.renderCurrentNoteSection(contentEl);

    if (this.vaultScan) {
      contentEl.createEl("hr", { cls: "mv-sidebar-divider" });
      this.renderVaultIssuesSection(contentEl, this.vaultScan);
    }
  }

  private renderVaultStats(container: HTMLElement, report: VaultScanReport): void {
    const { stats } = report;
    const section = container.createDiv("mv-vault-stats");
    section.createEl("h4", { text: "Vault health", cls: "mv-vault-stats-title" });

    const clean = stats.total - stats.errors - stats.warnings - stats.noSchema;
    const rows: Array<{ label: string; count: number; cls: string }> = [
      { label: "notes scanned", count: stats.total, cls: "" },
      { label: "with errors", count: stats.errors, cls: "mv-stat-errors" },
      { label: "with warnings", count: stats.warnings, cls: "mv-stat-warnings" },
      { label: "clean", count: clean, cls: "mv-stat-clean" },
      { label: "without schema", count: stats.noSchema, cls: "mv-stat-none" },
    ];

    for (const row of rows) {
      const rowEl = section.createDiv("mv-stat-row");
      rowEl.createEl("span", { text: String(row.count), cls: `mv-stat-count ${row.cls}` });
      rowEl.createEl("span", { text: " " + row.label, cls: "mv-stat-label" });
    }

    section.createDiv({
      text: `Last scan: ${new Date(report.scannedAt).toLocaleTimeString()}`,
      cls: "mv-vault-stats-time",
    });
  }

  private renderCurrentNoteSection(container: HTMLElement): void {
    container.createEl("h4", { text: "Current note", cls: "mv-sidebar-section-title" });

    if (!this.fileName) {
      container.createEl("p", {
        text: "Open a note to see validation results.",
        cls: "mv-sidebar-empty",
      });
      return;
    }

    container.createEl("p", { text: this.fileName, cls: "mv-sidebar-filename" });

    const errors = this.results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = this.results.filter((r) => !r.autoFixed && r.severity === "warning");
    const autoFixed = this.results.filter((r) => r.autoFixed);

    if (errors.length === 0 && warnings.length === 0) {
      const ok = container.createDiv("mv-sidebar-ok");
      ok.createEl("span", { text: "✓ " });
      ok.appendText(
        autoFixed.length > 0 ? `all valid, auto-fixed: ${autoFixed.length}` : "all valid"
      );
      return;
    }

    for (const result of [...errors, ...warnings]) {
      this.renderIssueRow(container, result, "mv-sidebar-row");
    }

    if (autoFixed.length > 0) {
      container.createDiv({
        text: `⚙ auto-fixed: ${autoFixed.length}`,
        cls: "mv-sidebar-autofixed",
      });
    }

    container.createDiv({
      text: `${errors.length} error(s) · ${warnings.length} warning(s)`,
      cls: "mv-sidebar-summary",
    });
  }

  private renderVaultIssuesSection(container: HTMLElement, report: VaultScanReport): void {
    const section = container.createDiv("mv-vault-issues");
    section.createEl("h4", {
      text: "Notes with issues in vault",
      cls: "mv-vault-issues-title",
    });

    if (report.reports.length === 0) {
      section.createEl("p", {
        text: "No notes with issues found.",
        cls: "mv-vault-issues-empty",
      });
      return;
    }

    const totalErrors = report.reports
      .flatMap((note) => note.results)
      .filter((result) => result.severity === "error").length;
    const totalWarnings = report.reports
      .flatMap((note) => note.results)
      .filter((result) => result.severity === "warning").length;

    section.createEl("p", {
      text: `${report.reports.length} notes with issues · ${totalErrors} errors · ${totalWarnings} warnings`,
      cls: "mv-vault-issues-summary",
    });

    const groups = this.groupVaultIssuesByManifest(report.reports);
    for (const group of groups) {
      const details = section.createEl("details", { cls: "mv-vault-group" });
      details.open = this.groupExpanded.get(group.manifestPath) ?? false;
      details.addEventListener("toggle", () => {
        this.groupExpanded.set(group.manifestPath, details.open);
      });

      const summary = details.createEl("summary", { cls: "mv-vault-group-summary" });
      summary.createEl("span", { text: group.manifestName, cls: "mv-vault-group-title" });
      summary.createEl("span", {
        text: `${group.reports.length} notes · ${group.errors} errors · ${group.warnings} warnings`,
        cls: "mv-vault-group-meta",
      });

      const body = details.createDiv("mv-vault-group-body");
      for (const note of group.reports) {
        const noteSection = body.createDiv("mv-vault-note");
        const noteHeader = noteSection.createDiv("mv-vault-note-header");

        const noteLink = noteHeader.createEl("button", {
          text: note.fileName,
          cls: "mv-vault-note-link",
        });
        noteLink.addEventListener("click", () => {
          void this.app.workspace.openLinkText(note.filePath, "");
        });

        const noteErrors = note.results.filter((result) => result.severity === "error").length;
        const noteWarnings = note.results.filter((result) => result.severity === "warning").length;
        noteHeader.createEl("span", {
          text: `${noteErrors} / ${noteWarnings}`,
          cls: "mv-vault-note-meta",
        });

        noteSection.createDiv({ text: note.filePath, cls: "mv-vault-note-path" });

        for (const result of note.results) {
          this.renderIssueRow(noteSection, result, "mv-vault-issue-row");
        }
      }
    }
  }

  private renderIssueRow(container: HTMLElement, result: ValidationResult, rowClass: string): void {
    const row = container.createDiv(rowClass);
    row.createEl("span", {
      text: result.severity === "error" ? "⚠ " : "ℹ ",
      cls: result.severity === "error" ? "mv-error" : "mv-warning",
    });
    row.createEl("strong", { text: result.field + ": " });
    row.createEl("span", { text: result.message });
  }

  private groupVaultIssuesByManifest(reports: VaultIssueNote[]): VaultIssueGroup[] {
    const groups = new Map<string, VaultIssueGroup>();

    for (const report of reports) {
      const existing = groups.get(report.manifestPath);
      if (!existing) {
        groups.set(report.manifestPath, {
          manifestPath: report.manifestPath,
          manifestName: report.manifestName,
          reports: [report],
          errors: report.results.filter((result) => result.severity === "error").length,
          warnings: report.results.filter((result) => result.severity === "warning").length,
        });
        continue;
      }

      existing.reports.push(report);
      existing.errors += report.results.filter((result) => result.severity === "error").length;
      existing.warnings += report.results.filter((result) => result.severity === "warning").length;
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        reports: group.reports.sort((a, b) => {
          const aErrors = a.results.filter((result) => result.severity === "error").length;
          const bErrors = b.results.filter((result) => result.severity === "error").length;
          return bErrors - aErrors;
        }),
      }))
      .sort((a, b) => {
        if (b.errors !== a.errors) return b.errors - a.errors;
        if (b.warnings !== a.warnings) return b.warnings - a.warnings;
        return a.manifestName.localeCompare(b.manifestName);
      });
  }

  private buildClipboardText(report: VaultScanReport): string {
    const lines: string[] = [
      "Metadata Validator - vault issues",
      `Scan time: ${new Date(report.scannedAt).toLocaleString()}`,
      "",
      `Scanned: ${report.stats.total}`,
      `With errors: ${report.stats.errors}`,
      `With warnings: ${report.stats.warnings}`,
      `Without schema: ${report.stats.noSchema}`,
      "",
    ];

    const groups = this.groupVaultIssuesByManifest(report.reports);
    for (const group of groups) {
      lines.push(`Manifest: ${group.manifestName} (${group.manifestPath})`);
      for (const note of group.reports) {
        lines.push(`- ${note.fileName} [${note.filePath}]`);
        for (const result of note.results) {
          lines.push(
            `  - ${result.severity.toUpperCase()} ${result.field}: ${result.message} (rule: ${result.rule})`
          );
        }
      }
      lines.push("");
    }

    if (groups.length === 0) {
      lines.push("No issues found.");
    }

    return lines.join("\n");
  }

  private async copyVaultIssuesToClipboard(): Promise<void> {
    if (!this.vaultScan || this.vaultScan.reports.length === 0) return;

    try {
      await this.writeClipboardText(this.buildClipboardText(this.vaultScan));
      new Notice("Issues copied to clipboard.");
    } catch (error) {
      console.error("[MetadataValidator] Failed to copy issues to clipboard", error);
      new Notice("Failed to copy issues to clipboard.");
    }
  }

  private async writeClipboardText(text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is not available");
    }

    await navigator.clipboard.writeText(text);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async runScanVault(): Promise<void> {
    if (!this.onScanVault || this.isScanningVault || this.isApplyingAutoFixes) return;

    this.vaultScan = null;
    this.isScanningVault = true;
    this.render();
    const progressNotice = new Notice(this.formatScanNotice({ processed: 0, total: 0 }), 0);

    try {
      await this.nextPaint();
      await this.onScanVault((progress) => {
        progressNotice.setMessage(this.formatScanNotice(progress));
      });
      progressNotice.setMessage("Vault scan completed.");
      window.setTimeout(() => progressNotice.hide(), 1200);
    } catch (error) {
      console.error("[MetadataValidator] Vault scan failed", error);
      progressNotice.setMessage("Vault scan failed. Check developer console.");
      window.setTimeout(() => progressNotice.hide(), 2400);
    } finally {
      this.isScanningVault = false;
      this.render();
    }
  }

  private formatScanNotice(progress: VaultScanProgress): string {
    const total = Math.max(0, progress.total);
    const processed = Math.max(
      0,
      total > 0 ? Math.min(progress.processed, total) : progress.processed
    );
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    const bar = this.renderProgressBar(processed, total, 14);
    const totalText = total > 0 ? String(total) : "?";
    return `Scanning vault ${bar} ${processed}/${totalText} (${percent}%)`;
  }

  private renderProgressBar(processed: number, total: number, width: number): string {
    const safeWidth = Math.max(1, width);
    if (total <= 0) {
      return `[${".".repeat(safeWidth)}]`;
    }

    const ratio = Math.max(0, Math.min(1, processed / total));
    const filled = Math.round(ratio * safeWidth);
    return `[${"#".repeat(filled)}${".".repeat(safeWidth - filled)}]`;
  }

  private async nextPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
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
