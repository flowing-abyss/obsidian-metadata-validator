import type { App, TFile } from "obsidian";
import type { ResolvedSchema, ValidationResult } from "../types";
import { sameValue } from "./auto-fix";
import type { SelfWrites } from "./self-writes";
import type { WriteBudget } from "./write-budget";

export interface PersistEngineChangesInput {
  app: App;
  file: TFile;
  schema: ResolvedSchema;
  results: ValidationResult[];
  /** Frontmatter as read from the cache, before the engine ran */
  before: Record<string, unknown>;
  /** The same object after the engine mutated it in place */
  after: Record<string, unknown>;
  /** Caps rule-triggered writes per note so conflicting rules cannot ping-pong forever */
  writeBudget?: Pick<WriteBudget, "allow">;
  /** Marks the write so the resulting "changed" event is not treated as a user edit */
  selfWrites?: Pick<SelfWrites, "mark">;
}

/**
 * Persist what the engine changed, and only that.
 *
 * The cached frontmatter is never written back as a whole: another plugin may
 * have edited the file since we read the cache (a picker save), and some plugins
 * mutate Obsidian's cached objects in place (Longform empties `longform.scenes`
 * there). `processFrontMatter` re-parses the file on disk inside its callback, so
 * applying the value-level diff there is atomic and leaves untouched keys intact.
 *
 * Returns true when a write was made. Pushes a `write-budget` warning when the
 * budget denies a rule-triggered write.
 */
export async function persistEngineChanges(input: PersistEngineChangesInput): Promise<boolean> {
  const { app, file, schema, results, before, after } = input;
  if (!results.some((r) => r.autoFixed)) return false;

  const changes: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (!(k in before) || !sameValue(before[k], after[k])) changes[k] = after[k];
  }
  const hasValueChanges = Object.keys(changes).length > 0;
  const hasOrderChange = results.some((r) => r.rule === "property-order");
  const effectiveOrder = schema.formatting.property_order?.length
    ? schema.formatting.property_order
    : Object.keys(schema.fields);
  const applyOrdering = hasOrderChange && effectiveOrder.length > 0;

  if (!hasValueChanges && !applyOrdering) return false;

  const rulesChanged = results.some((r) => r.rule === "rules" && r.autoFixed);
  if (rulesChanged && input.writeBudget !== undefined && !input.writeBudget.allow(file.path)) {
    results.push({
      field: "__rules__",
      severity: "warning",
      message:
        "Auto-fix paused for this note: too many rule-triggered writes in a short time. Check the rules for conflicts.",
      rule: "write-budget",
      manifestPath: schema.manifestPath,
      autoFixed: false,
    });
    return false;
  }

  input.selfWrites?.mark(file.path);
  await app.fileManager.processFrontMatter(file, (latestFm) => {
    const latest = latestFm as Record<string, unknown>;
    for (const [k, v] of Object.entries(changes)) latest[k] = v;
    if (applyOrdering) applyOrder(latest, effectiveOrder);
  });
  return true;
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
