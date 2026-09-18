import type { RuleSelection } from "../types";
import { evaluateCondition } from "./condition";
import { contextForFile, type NoteContext, type RuleEnv } from "./context";
import { isWikiLink, linkTarget, valuesEqual } from "./link-text";

const RESERVED = new Set(["js", "and", "or", "not", "when"]);

/** `{ prop: { when?: ... } }` with at least one key and nothing but an optional `when` inside. */
export function isSelection(v: unknown): v is RuleSelection {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (entries.length === 0) return false;
  return entries.every(([key, spec]) => {
    if (RESERVED.has(key)) return false;
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return false;
    return Object.keys(spec as object).every((k) => k === "when");
  });
}

/**
 * Values of each property that pass its `when`, evaluated on the note behind
 * the link. Without `when` every value is selected. Unresolved links and plain
 * strings never pass a filter. Union across keys, no duplicates.
 */
export async function resolveSelection(
  sel: RuleSelection,
  target: NoteContext,
  env: RuleEnv
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const [prop, spec] of Object.entries(sel)) {
    const raw = target.frontmatter[prop];
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    for (const value of values) {
      if (spec.when !== undefined) {
        if (!isWikiLink(value)) continue;
        const file = env.app.metadataCache.getFirstLinkpathDest(linkTarget(value), env.file.path);
        if (!file) continue;
        const ctx = contextForFile(file, env.app);
        if (!(await evaluateCondition(spec.when, ctx, env))) continue;
      }
      if (!out.some((existing) => valuesEqual(existing, value))) out.push(value);
    }
  }
  return out;
}
