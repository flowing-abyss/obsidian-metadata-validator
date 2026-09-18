import { linkName, valueText } from "../../rules/link-text";
import type { FieldOption, ValidationResult } from "../../types";

export function checkLinkSource(
  field: string,
  value: unknown,
  allowedOptions: FieldOption[],
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(allowedOptions.map((o) => o.value));
  // Compare by note name: [[path/Name.md#heading|alias]] and plain "Name" are the same note
  const strip = (v: unknown): string => linkName(valueText(v));
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
