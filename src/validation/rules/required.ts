import type { ValidationResult } from "../../types";

export function checkRequired(
  field: string,
  value: unknown,
  manifestPath: string
): ValidationResult | null {
  // Only error if the key is completely absent
  if (value !== undefined) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" is required but missing. Add the property.`,
    rule: "required",
    manifestPath,
    autoFixed: false,
  };
}
