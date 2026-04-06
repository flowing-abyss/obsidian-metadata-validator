import type { App, TFile } from "obsidian";
import type { ValidationResult } from "../../types";

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
    // Obsidian stores internal links in frontmatter as "[[basename]]" — strip the brackets
    const raw = String(v).trim();
    const name = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    if (!name) continue;
    const found = app.vault
      .getMarkdownFiles()
      .some((f: TFile) => f.basename === name || f.path === name);
    if (!found) missing.push(name);
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
