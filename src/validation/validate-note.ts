import type { App, TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ResolvedSchema, ValidationResult } from "../types";
import type { ValidationEngine } from "./engine";
import { sanitizeFrontmatter } from "./frontmatter";
import { persistEngineChanges } from "./persist";
import { checkFolderLocation } from "./rules/folder-location";
import type { SelfWrites } from "./self-writes";
import type { WriteBudget } from "./write-budget";

interface ValidateNoteDependencies {
  app: App;
  resolver: Pick<SchemaResolver, "resolveForNote">;
  engine: Pick<ValidationEngine, "validate">;
  /** Caps rule-triggered writes per note so conflicting rules cannot ping-pong forever */
  writeBudget?: Pick<WriteBudget, "allow">;
  selfWrites?: Pick<SelfWrites, "mark">;
}

interface ValidateNoteOutcome {
  schema: ResolvedSchema | null;
  results: ValidationResult[];
  /** True when the note was moved into its schema's enforce_folder */
  moved: boolean;
}

/**
 * Validate a single note against its resolved schema and persist any auto-fixes.
 *
 * Moves the note into its enforce_folder first when needed, then keeps going: a
 * rename does not emit metadataCache "changed", so stopping after the move would
 * leave the note un-fixed until some unrelated write happens to touch it again.
 */
export async function validateNote(
  deps: ValidateNoteDependencies,
  file: TFile
): Promise<ValidateNoteOutcome> {
  const { app, resolver, engine } = deps;
  const frontmatter = sanitizeFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);
  let schema = resolver.resolveForNote(file, frontmatter);

  if (!schema) return { schema: null, results: [], moved: false };

  // enforce_folder: only a string path is actionable now (true alone has no effect)
  const enforcePath = typeof schema.enforce_folder === "string" ? schema.enforce_folder : undefined;

  let moved = false;
  if (enforcePath) {
    const moveResult = checkFolderLocation(file.path, enforcePath, schema.manifestPath);
    if (moveResult) {
      // renameFile updates the TFile in place, so `file` keeps working below
      await app.fileManager.renameFile(file, moveResult.targetPath);
      moved = true;
      // A path-scoped target may match a different schema at the new location
      schema = resolver.resolveForNote(file, frontmatter) ?? schema;
    }
  }

  // Snapshot before engine mutates frontmatter in place (via applyAutoFix / applyPropertyOrder)
  const preEngineFrontmatter: Record<string, unknown> = { ...frontmatter };

  const results = await engine.validate(file, frontmatter, schema);

  appendLegacyEnforceFolderWarning(results, schema.enforce_folder, schema.manifestPath);

  await persistEngineChanges({
    app,
    file,
    schema,
    results,
    before: preEngineFrontmatter,
    after: frontmatter,
    writeBudget: deps.writeBudget,
    selfWrites: deps.selfWrites,
  });

  return { schema, results, moved };
}

export function appendLegacyEnforceFolderWarning(
  results: ValidationResult[],
  enforceFolder: boolean | string | undefined,
  manifestPath: string
): void {
  if (enforceFolder !== true) return;

  results.push({
    field: "__location__",
    severity: "warning",
    message:
      "enforce_folder: true has no effect on its own. Set enforce_folder to a folder path string.",
    rule: "enforce_folder",
    manifestPath,
    autoFixed: false,
  });
}
