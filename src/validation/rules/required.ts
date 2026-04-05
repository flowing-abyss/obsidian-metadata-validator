import type { ValidationResult } from "../../types";

export function checkRequired(
  field: string,
  value: unknown,
  manifestPath: string
): ValidationResult | null {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  if (!isEmpty) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" is required but empty.`,
    rule: "required",
    manifestPath,
    autoFixed: false,
  };
}
