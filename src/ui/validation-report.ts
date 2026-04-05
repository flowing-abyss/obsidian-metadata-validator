import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ValidationEngine } from "../validation/engine";
import type { ValidationResult } from "../types";

interface NoteReport {
  file: TFile;
  results: ValidationResult[];
}

export class ValidationReportModal extends Modal {
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private reports: NoteReport[] = [];

  constructor(app: App, resolver: SchemaResolver, engine: ValidationEngine) {
    super(app);
    this.resolver = resolver;
    this.engine = engine;
  }

  async onOpen(): Promise<void> {
    this.contentEl.createEl("p", { text: "Scanning vault…" });
    await this.runScan();
    this.render();
  }

  private async runScan(): Promise<void> {
    this.reports = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
      const schema = this.resolver.resolveForNote(file, fm);
      if (!schema) continue;

      const results = await this.engine.validate(file, fm, schema);
      const issues = results.filter((r) => !r.autoFixed);
      if (issues.length > 0) {
        this.reports.push({ file, results: issues });
      }
    }

    this.reports.sort((a, b) => {
      const ae = a.results.filter((r) => r.severity === "error").length;
      const be = b.results.filter((r) => r.severity === "error").length;
      return be - ae;
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Vault validation report" });

    if (this.reports.length === 0) {
      contentEl.createEl("p", { text: "✓ no issues found." });
      return;
    }

    const totalErrors = this.reports
      .flatMap((r) => r.results)
      .filter((r) => r.severity === "error").length;

    contentEl.createEl("p", {
      text: `${this.reports.length} note(s) with issues · ${totalErrors} error(s) total`,
      cls: "mv-report-summary",
    });

    for (const report of this.reports) {
      const section = contentEl.createDiv("mv-report-section");

      const fileLink = section.createEl("a", {
        text: report.file.basename,
        cls: "mv-report-file-link",
      });
      fileLink.addEventListener("click", () => {
        void this.app.workspace.openLinkText(report.file.path, "");
        this.close();
      });

      for (const result of report.results) {
        const row = section.createDiv("mv-report-row");
        row.createEl("span", {
          text: result.severity === "error" ? "⚠ " : "ℹ ",
          cls: result.severity === "error" ? "mv-tooltip-error" : "mv-tooltip-warning",
        });
        row.createEl("strong", { text: result.field + ": " });
        row.createEl("span", { text: result.message });
      }
    }

    contentEl.createEl("p", {
      text: `Last scan: ${new Date().toLocaleTimeString()}`,
      cls: "mv-report-footer",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
