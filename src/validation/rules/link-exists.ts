import type { App } from "obsidian";
import type { ValidationResult } from "../../types";

/**
 * Resolve a wikilink / plain basename to a vault file.
 * Handles all common forms:
 *   [[people/man.md]]  [[people/man]]  [[man]]  [[people/man|Display]]  man
 */
function resolveLink(raw: string, app: App): boolean {
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

  const files = app.vault.getMarkdownFiles();
  return files.some((f) => {
    const pathNoExt = f.path.replace(/\.md$/, "");
    // Exact path match (e.g. "people/man")
    if (pathNoExt === target) return true;
    // Basename match (e.g. "man")
    if (f.basename === target) return true;
    // Partial-path suffix match (e.g. "man" → "people/man")
    if (pathNoExt.endsWith("/" + target)) return true;
    return false;
  });
}

export function checkLinkExists(
  field: string,
  value: unknown,
  app: App,
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const values = Array.isArray(value) ? value : [value];
  const missing: string[] = [];

  for (const v of values) {
    const raw = String(v).trim();
    if (!raw) continue;
    if (!resolveLink(raw, app)) missing.push(raw);
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
