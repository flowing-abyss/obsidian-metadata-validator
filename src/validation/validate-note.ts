import type { App, TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ResolvedSchema, ValidationResult } from "../types";
import type { ValidationEngine } from "./engine";
import { sanitizeFrontmatter } from "./frontmatter";
import { checkFolderLocation } from "./rules/folder-location";
import type { WriteBudget } from "./write-budget";

interface ValidateNoteDependencies {
  app: App;
  resolver: Pick<SchemaResolver, "resolveForNote">;
  engine: Pick<ValidationEngine, "validate">;
  /** Caps rule-triggered writes per note so conflicting rules cannot ping-pong forever */
  writeBudget?: Pick<WriteBudget, "allow">;
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

  const hasAutoFix = results.some((r) => r.autoFixed);
  if (hasAutoFix) {
    // Compute which keys the engine actually changed (value-level diff).
    // This is critical: we must NOT write the full stale `frontmatter` snapshot because a
    // concurrent picker save (via processFrontMatter) may have already updated the file
    // between when we read the cache and now. Writing the whole snapshot would overwrite the
    // user's new value with the old one (TOCTOU race condition).
    const engineValueChanges: Record<string, unknown> = {};
    for (const k of Object.keys(frontmatter)) {
      if (!(k in preEngineFrontmatter) || preEngineFrontmatter[k] !== frontmatter[k]) {
        engineValueChanges[k] = frontmatter[k];
      }
    }
    const hasValueChanges = Object.keys(engineValueChanges).length > 0;
    const hasOrderChange = results.some((r) => r.rule === "property-order");
    const effectiveOrder = schema.formatting.property_order?.length
      ? schema.formatting.property_order
      : Object.keys(schema.fields);

    const rulesChanged = results.some((r) => r.rule === "rules" && r.autoFixed);
    const overBudget =
      rulesChanged && deps.writeBudget !== undefined && !deps.writeBudget.allow(file.path);
    if (overBudget) {
      results.push({
        field: "__rules__",
        severity: "warning",
        message:
          "Auto-fix paused for this note: too many rule-triggered writes in a short time. Check the rules for conflicts.",
        rule: "write-budget",
        manifestPath: schema.manifestPath,
        autoFixed: false,
      });
    } else if (hasValueChanges || (hasOrderChange && effectiveOrder.length)) {
      // Apply only the engine-computed value changes onto the LATEST frontmatter.
      // processFrontMatter reads the current file state inside its callback, so it is
      // atomic with respect to other processFrontMatter calls and never races with the picker.
      await app.fileManager.processFrontMatter(file, (latestFm) => {
        const latestFrontmatter = latestFm as Record<string, unknown>;
        for (const [k, v] of Object.entries(engineValueChanges)) {
          latestFrontmatter[k] = v;
        }
        // Re-apply property ordering to the latest frontmatter in the same atomic write
        if (hasOrderChange && effectiveOrder.length) {
          applyOrder(latestFrontmatter, effectiveOrder);
        }
      });
    }
  }

  return { schema, results, moved };
}

function applyOrder(frontmatter: Record<string, unknown>, order: string[]): void {
  const keys = Object.keys(frontmatter);
  const orderedKeys = [
    ...order.filter((ok) => keys.includes(ok)),
    ...keys.filter((k) => !order.includes(k)),
  ];
  if (orderedKeys.every((k, i) => k === keys[i])) return;
  const copy: Record<string, unknown> = { ...frontmatter };
  for (const k of keys) Reflect.deleteProperty(frontmatter, k);
  for (const k of orderedKeys) frontmatter[k] = copy[k];
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
