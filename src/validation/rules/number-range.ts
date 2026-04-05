import type { ValidationResult } from "../../types";

export function checkNumberRange(
  field: string,
  value: unknown,
  min: number | undefined,
  max: number | undefined,
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const num = Number(value);
  if (isNaN(num)) return null;

  if (min !== undefined && num < min) {
    return {
      field,
      severity: "error",
      message: `"${field}" value ${num} is below minimum ${min}.`,
      rule: "number-range",
      manifestPath,
      autoFixed: false,
    };
  }
  if (max !== undefined && num > max) {
    return {
      field,
      severity: "error",
      message: `"${field}" value ${num} exceeds maximum ${max}.`,
      rule: "number-range",
      manifestPath,
      autoFixed: false,
    };
  }
  return null;
}
