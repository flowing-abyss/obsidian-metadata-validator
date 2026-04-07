import type { App, TFile } from "obsidian";
import type { ManifestField, ResolvedSchema, ValidationResult } from "../types";
import { applyAutoFix } from "./auto-fix";
import { checkRequired } from "./rules/required";
import { checkOptions } from "./rules/options";
import { checkLinkSource } from "./rules/link-source";
import { checkLinkExists } from "./rules/link-exists";
import { checkDateFormat } from "./rules/date-format";
import { checkNumberRange } from "./rules/number-range";
import { runJsValidator } from "./rules/js-validator";
import { resolveSource } from "../schema/source-resolver";

export class ValidationEngine {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async validate(
    file: TFile,
    frontmatter: Record<string, unknown>,
    schema: ResolvedSchema
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const fieldResults = await this.validateField(
        fieldName,
        fieldDef,
        frontmatter,
        file,
        schema.manifestPath
      );
      results.push(...fieldResults);
    }

    // Apply ordering: explicit property_order wins; fall back to schema field definition order
    const effectiveOrder = schema.formatting.property_order?.length
      ? schema.formatting.property_order
      : Object.keys(schema.fields);
    if (effectiveOrder.length) {
      const reordered = this.applyPropertyOrder(frontmatter, effectiveOrder);
      if (reordered) {
        results.push({
          field: "__order__",
          severity: "info",
          message: "Properties reordered.",
          rule: "property-order",
          manifestPath: schema.manifestPath,
          autoFixed: true,
        });
      }
    }

    return results;
  }

  private async validateField(
    fieldName: string,
    field: ManifestField,
    frontmatter: Record<string, unknown>,
    file: TFile,
    manifestPath: string
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Capture the value before auto-fix so we can skip options validation when a
    // default was inserted into an empty field (user never chose that value).
    const preFixValue = frontmatter[fieldName];
    const isEmpty =
      preFixValue === undefined ||
      preFixValue === null ||
      preFixValue === "" ||
      (Array.isArray(preFixValue) && preFixValue.length === 0);

    const wasFixed = applyAutoFix(fieldName, field, frontmatter);
    if (wasFixed) {
      results.push({
        field: fieldName,
        severity: "info",
        message: `"${fieldName}" was auto-corrected.`,
        rule:
          field.fixed !== undefined ? "fixed" : field.default !== undefined ? "default" : "sort",
        manifestPath,
        autoFixed: true,
      });
    }

    const value = frontmatter[fieldName];

    if (field.required) {
      const r = checkRequired(fieldName, value, manifestPath);
      if (r) results.push(r);
    }

    if (field.options && Array.isArray(field.options)) {
      // Skip options check when auto-fix inserted a value into an empty field —
      // the user never chose this value (it came from `default` or `fixed`),
      // so reporting it as invalid would be confusing and unactionable.
      const skipOptions = wasFixed && isEmpty;
      if (!skipOptions) {
        const r = checkOptions(
          fieldName,
          value,
          field.options,
          manifestPath,
          field.strict !== false
        );
        if (r) results.push(r);
      }
    }

    if (field.type === "number" && (field.min !== undefined || field.max !== undefined)) {
      const r = checkNumberRange(fieldName, value, field.min, field.max, manifestPath);
      if (r) results.push(r);
    }

    if (field.type === "date") {
      const r = checkDateFormat(fieldName, value, field.format, manifestPath);
      if (r) results.push(r);
    }

    if ((field.type === "link" || field.type === "multilink") && field.source) {
      const allowedOptions = await resolveSource(field.source, this.app, file);
      const r = checkLinkSource(fieldName, value, allowedOptions, manifestPath);
      if (r) results.push(r);
    }

    if ((field.type === "link" || field.type === "multilink") && field.validate_exists !== false) {
      const r = checkLinkExists(fieldName, value, this.app, manifestPath, file.path);
      if (r) results.push(r);
    }

    if (field.validate?.js) {
      const r = await runJsValidator(
        fieldName,
        value,
        field.validate.js,
        this.app,
        file,
        manifestPath
      );
      if (r) results.push(r);
    }

    return results;
  }

  private applyPropertyOrder(frontmatter: Record<string, unknown>, order: string[]): boolean {
    const keys = Object.keys(frontmatter);
    const orderedKeys = [
      ...order.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !order.includes(k)),
    ];
    if (orderedKeys.every((k, i) => k === keys[i])) return false;
    const copy = { ...frontmatter };
    for (const k of Object.keys(frontmatter)) delete frontmatter[k];
    for (const k of orderedKeys) frontmatter[k] = copy[k];
    return true;
  }
}
