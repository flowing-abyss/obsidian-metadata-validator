import type { FieldOption, ValidationResult } from "../../types";

export function checkOptions(
  field: string,
  value: unknown,
  options: FieldOption[],
  manifestPath: string,
  strict = true
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(options.map((o) => o.value));
  const values = Array.isArray(value) ? value : [value];

  // Non-strict: only validate values that are in the managed set (the options list).
  // Values outside the options list are unmanaged — ignore them entirely.
  const toCheck = strict ? values : values.filter((v) => allowed.has(String(v)));
  const invalid = toCheck.filter((v) => !allowed.has(String(v)));

  if (invalid.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" contains invalid value(s): ${invalid.map((v) => `"${String(v)}"`).join(", ")}. Allowed: ${[...allowed].join(", ")}.`,
    rule: "options",
    manifestPath,
    autoFixed: false,
  };
}
