import type { App } from "obsidian";
import type { ValidationResult } from "../../types";

/**
 * Resolve a wikilink / plain basename to a vault file.
 * Uses metadataCache.getFirstLinkpathDest — an O(1) lookup via Obsidian's
 * internal link index, so no vault scan is needed.
 */
function resolveLink(raw: string, app: App, sourcePath: string): boolean {
  let target = raw.trim();

  // Strip [[ ]] wrapper
  if (target.startsWith("[[")) target = target.slice(2);
  if (target.endsWith("]]")) target = target.slice(0, -2);

  // Strip display text after |
  const pipeIdx = target.indexOf("|");
  if (pipeIdx !== -1) target = target.slice(0, pipeIdx);

  // Strip .md extension
  target = target.replace(/\.md$/, "").trim();
  if (!target) return false;

  return app.metadataCache.getFirstLinkpathDest(target, sourcePath) !== null;
}

export function checkLinkExists(
  field: string,
  value: unknown,
  app: App,
  manifestPath: string,
  /** Path of the note being validated — used by Obsidian to resolve relative links. */
  sourcePath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const values = Array.isArray(value) ? value : [value];
  const missing: string[] = [];

  for (const v of values) {
    const raw = String(v).trim();
    if (!raw) continue;
    if (!resolveLink(raw, app, sourcePath)) missing.push(raw);
  }

  if (missing.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" links to non-existent note(s): ${missing.map((v) => `"${v}"`).join(", ")}.`,
    rule: "link-exists",
    manifestPath,
    autoFixed: false,
  };
}
