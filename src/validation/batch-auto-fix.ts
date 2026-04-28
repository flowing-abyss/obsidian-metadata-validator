import type { App, TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ValidationEngine } from "./engine";
import { sanitizeFrontmatter } from "./frontmatter";
import { checkFolderLocation } from "./rules/folder-location";

type FileValidationStatus = "error" | "warning" | "valid" | "none";

interface BatchAutoFixFileResult {
  previousPath: string;
  filePath: string;
  status: FileValidationStatus;
  autoFixed: number;
  errors: number;
  warnings: number;
  moved: boolean;
}

interface BatchAutoFixSummary {
  total: number;
  matched: number;
  changed: number;
  moved: number;
  autoFixed: number;
  errors: number;
  warnings: number;
  noSchema: number;
  failed: number;
}

interface BatchAutoFixDependencies {
  app: App;
  schemasRoot: string;
  resolver: Pick<SchemaResolver, "resolveForNote">;
  engine: Pick<ValidationEngine, "validate">;
  writeFrontmatter: (file: TFile, frontmatter: Record<string, unknown>) => Promise<void>;
  onFileProcessed?: (result: BatchAutoFixFileResult) => void;
}

export async function applyVaultAutoFixes(
  deps: BatchAutoFixDependencies
): Promise<BatchAutoFixSummary> {
  const schemasRoot = deps.schemasRoot.replace(/\/+$/, "");
  const files = deps.app.vault
    .getMarkdownFiles()
    .filter((file) => !file.path.startsWith(`${schemasRoot}/`));

  const summary: BatchAutoFixSummary = {
    total: files.length,
    matched: 0,
    changed: 0,
    moved: 0,
    autoFixed: 0,
    errors: 0,
    warnings: 0,
    noSchema: 0,
    failed: 0,
  };

  for (const originalFile of files) {
    const previousPath = originalFile.path;

    try {
      let file = originalFile;
      const frontmatter = sanitizeFrontmatter(
        deps.app.metadataCache.getFileCache(file)?.frontmatter
      );
      let schema = deps.resolver.resolveForNote(file, frontmatter);

      if (!schema) {
        summary.noSchema++;
        deps.onFileProcessed?.({
          previousPath,
          filePath: file.path,
          status: "none",
          autoFixed: 0,
          errors: 0,
          warnings: 0,
          moved: false,
        });
        continue;
      }

      summary.matched++;
      let moved = false;

      const enforcePath =
        typeof schema.enforce_folder === "string" ? schema.enforce_folder : undefined;
      if (enforcePath) {
        const moveResult = checkFolderLocation(file.path, enforcePath, schema.manifestPath);
        if (moveResult) {
          await deps.app.fileManager.renameFile(file, moveResult.targetPath);
          moved = true;
          summary.moved++;
          const refreshed = deps.app.vault.getAbstractFileByPath(moveResult.targetPath);
          if (isTFileLike(refreshed)) file = refreshed;
          schema = deps.resolver.resolveForNote(file, frontmatter) ?? schema;
        }
      }

      const results = await deps.engine.validate(file, frontmatter, schema);
      const autoFixed = results.filter((result) => result.autoFixed).length;
      const errors = results.filter(
        (result) => !result.autoFixed && result.severity === "error"
      ).length;
      const warnings = results.filter(
        (result) => !result.autoFixed && result.severity === "warning"
      ).length;

      if (autoFixed > 0) {
        await deps.writeFrontmatter(file, frontmatter);
        summary.autoFixed += autoFixed;
      }

      if (moved || autoFixed > 0) summary.changed++;
      summary.errors += errors;
      summary.warnings += warnings;

      deps.onFileProcessed?.({
        previousPath,
        filePath: file.path,
        status: errors > 0 ? "error" : warnings > 0 ? "warning" : "valid",
        autoFixed,
        errors,
        warnings,
        moved,
      });
    } catch (error) {
      summary.failed++;
      console.error(`[MetadataValidator] Failed to auto-fix "${previousPath}"`, error);
    }
  }

  return summary;
}

function isTFileLike(value: unknown): value is TFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "basename" in value &&
    "extension" in value
  );
}
