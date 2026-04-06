import type { ValidationResult } from "../../types";

export function checkRequired(
  field: string,
  value: unknown,
  manifestPath: string
): ValidationResult | null {
  // Error if the key is absent or null (null is the auto-inserted placeholder)
  if (value !== undefined && value !== null) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" is required but missing. Add the property.`,
    rule: "required",
    manifestPath,
    autoFixed: false,
  };
}
