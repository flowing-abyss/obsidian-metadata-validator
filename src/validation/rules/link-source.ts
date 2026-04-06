import type { FieldOption, ValidationResult } from "../../types";

export function checkLinkSource(
  field: string,
  value: unknown,
  allowedOptions: FieldOption[],
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(allowedOptions.map((o) => o.value));
  // Obsidian stores internal links as "[[basename]]" — strip brackets before comparing
  const strip = (v: unknown) => String(v).trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter((v) => !allowed.has(strip(v)));

  if (invalid.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" links to note(s) not in allowed source: ${invalid.map((v) => `"${String(v)}"`).join(", ")}.`,
    rule: "link-source",
    manifestPath,
    autoFixed: false,
  };
}
