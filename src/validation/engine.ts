import type { App, TFile } from "obsidian";
import type { FieldOption, ManifestField, ResolvedSchema, ValidationResult } from "../types";
import type { PluginSettings } from "../settings";
import { runRules } from "../rules/runner";
import { applyAutoFix, normalizeField } from "./auto-fix";
import { checkRequired } from "./rules/required";
import { checkOptions } from "./rules/options";
import { checkLinkSource } from "./rules/link-source";
import { checkLinkExists } from "./rules/link-exists";
import { checkDateFormat } from "./rules/date-format";
import { checkNumberRange } from "./rules/number-range";
import { runJsValidator } from "./rules/js-validator";
import { resolveSourceWithStatus } from "../schema/source-resolver";

interface FieldFixInfo {
  /** applyAutoFix changed the value in the first pass */
  wasFixed: boolean;
  /** the value was empty before the first pass */
  isEmpty: boolean;
}

interface EngineOptions {
  /** Injectable clock for rule templates (tests) */
  now?: () => Date;
}

interface ValidateOptions {
  /**
   * Skip the rules phase. For display-only callers (property icons, Bases cells,
   * pickers) that validate a throwaway copy on every paint: rules may run user
   * JavaScript and walk linked notes, which belongs in the real save/open pass.
   */
  skipRules?: boolean;
}

/**
 * One validation pass over a note, in four phases:
 *   1. field auto-fix (`fixed`, `default`, required placeholder, shape)
 *   2. rules (state-based `when` / `then`)
 *   3. normalisation (list wrapping, `sort`) and `fixed` re-asserted
 *   4. field checks on the final state
 * followed by property ordering. Mutates `frontmatter` in place.
 */
export class ValidationEngine {
  private readonly app: App;
  private readonly settings: Pick<PluginSettings, "enableJsExecution">;
  private readonly now: (() => Date) | undefined;

  constructor(
    app: App,
    settings: Pick<PluginSettings, "enableJsExecution">,
    options: EngineOptions = {}
  ) {
    this.app = app;
    this.settings = settings;
    this.now = options.now;
  }

  async validate(
    file: TFile,
    frontmatter: Record<string, unknown>,
    schema: ResolvedSchema,
    options: ValidateOptions = {}
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const fields = Object.entries(schema.fields);
    const fixInfo = new Map<string, FieldFixInfo>();
    const runRulesPhase = !options.skipRules && schema.rules.length > 0;

    // Phase 1: field auto-fix
    for (const [fieldName, field] of fields) {
      const pre = frontmatter[fieldName];
      const isEmpty =
        pre === undefined || pre === null || pre === "" || (Array.isArray(pre) && pre.length === 0);
      const wasFixed = applyAutoFix(fieldName, field, frontmatter);
      fixInfo.set(fieldName, { wasFixed, isEmpty });
      if (wasFixed) {
        results.push(
          this.autoFixResult(
            fieldName,
            field.fixed !== undefined ? "fixed" : field.default !== undefined ? "default" : "sort",
            schema.manifestPath
          )
        );
      }
    }

    // Phase 2: rules
    if (runRulesPhase) {
      results.push(
        ...(await runRules({
          rules: schema.rules,
          app: this.app,
          file,
          frontmatter,
          fields: schema.fields,
          enableJs: this.settings.enableJsExecution,
          manifestPath: schema.manifestPath,
          now: this.now,
        }))
      );
    }

    // Phase 3: normalisation and fixed re-asserted (rules cannot override fixed)
    if (runRulesPhase) {
      for (const [fieldName, field] of fields) {
        if (field.fixed !== undefined && frontmatter[fieldName] !== field.fixed) {
          frontmatter[fieldName] = field.fixed;
          results.push(this.autoFixResult(fieldName, "fixed", schema.manifestPath));
        }
        if (normalizeField(fieldName, field, frontmatter)) {
          results.push(this.autoFixResult(fieldName, "sort", schema.manifestPath));
        }
      }
    }

    // Phase 4: checks on the final state
    for (const [fieldName, field] of fields) {
      const info = fixInfo.get(fieldName) ?? { wasFixed: false, isEmpty: false };
      results.push(
        ...(await this.checkField(fieldName, field, frontmatter, file, schema.manifestPath, info))
      );
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

  private autoFixResult(fieldName: string, rule: string, manifestPath: string): ValidationResult {
    return {
      field: fieldName,
      severity: "info",
      message: `"${fieldName}" was auto-corrected.`,
      rule,
      manifestPath,
      autoFixed: true,
    };
  }

  private async checkField(
    fieldName: string,
    field: ManifestField,
    frontmatter: Record<string, unknown>,
    file: TFile,
    manifestPath: string,
    info: FieldFixInfo
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const value = frontmatter[fieldName];

    if (field.required) {
      const r = checkRequired(fieldName, value, manifestPath);
      if (r) results.push(r);
    }

    if (field.options) {
      // Skip options validation when a default was inserted into an empty field
      // (the user never chose that value).
      const skipOptions = info.wasFixed && info.isEmpty;
      if (!skipOptions) {
        let resolvedOptions: FieldOption[] | null = null;
        if (Array.isArray(field.options)) {
          resolvedOptions = field.options;
        } else if (field.strict !== false) {
          // Dynamic options + strict mode: resolve the source to validate against it
          const src = field.options.source;
          if (src) {
            const resolution = await resolveSourceWithStatus(
              src,
              this.app,
              file,
              this.settings.enableJsExecution
            );
            // A disabled or failed source is not an empty allow-list. Skipping
            // validation here prevents every existing value from becoming invalid.
            if (resolution.status === "resolved") resolvedOptions = resolution.options;
          }
        }
        if (resolvedOptions) {
          const r = checkOptions(
            fieldName,
            value,
            resolvedOptions,
            manifestPath,
            field.strict !== false
          );
          if (r) results.push(r);
        }
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
      const resolution = await resolveSourceWithStatus(
        field.source,
        this.app,
        file,
        this.settings.enableJsExecution
      );
      if (resolution.status === "resolved") {
        const r = checkLinkSource(fieldName, value, resolution.options, manifestPath);
        if (r) results.push(r);
      }
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
        manifestPath,
        this.settings.enableJsExecution
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
