import type { App, TFile } from "obsidian";
import type { ManifestField, ManifestRule, RuleThen, ValidationResult } from "../types";
import { dataviewContext, executeJs, JsDisabledError } from "../utils/js-exec";
import { evaluateCondition, RuleConfigError } from "./condition";
import { contextFromFrontmatter, type RuleEnv } from "./context";
import { TemplateError } from "./template";
import { applyAdd, applyRemove, applySet, isListField, resolveRuleValue } from "./verbs";

export interface RunRulesInput {
  rules: ManifestRule[];
  app: App;
  file: TFile;
  /** Working frontmatter, mutated in place */
  frontmatter: Record<string, unknown>;
  fields: Record<string, ManifestField>;
  enableJs: boolean;
  manifestPath: string;
  /** Injectable clock for tests */
  now?: () => Date;
}

const VERBS = new Set(["set", "add", "remove", "js"]);
const VERB_PAST: Record<string, string> = { set: "set", add: "extended", remove: "trimmed" };

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null)) as T;
}

/** Display label of a rule: its name, else its `when` text, else its position. */
export function ruleLabel(rule: ManifestRule, index: number): string {
  if (rule.name) return rule.name;
  if (typeof rule.when === "string") return rule.when;
  return `#${index + 1}`;
}

/** `{ when: ... }` or `{}` standing alone in a value slot: a filter over the target property. */
function isBareFilter(v: unknown): v is { when?: unknown } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 0 || (keys.length === 1 && keys[0] === "when");
}

/**
 * Copy `scratch` back into `working`, keeping the original reference for every
 * key whose content did not change so the value-level diff stays silent.
 */
function commit(working: Record<string, unknown>, scratch: Record<string, unknown>): void {
  for (const key of Object.keys(working)) {
    if (!(key in scratch)) delete working[key];
  }
  for (const key of Object.keys(scratch)) {
    if (!(key in working) || !jsonEqual(working[key], scratch[key])) working[key] = scratch[key];
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Run rules in order. Each rule reads a snapshot of the note as it was when the
 * rule started and applies its verbs sequentially to a scratch copy; the copy is
 * committed only when every verb succeeded, so a failing rule changes nothing.
 */
export async function runRules(input: RunRulesInput): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const working = input.frontmatter;

  const changed = (field: string, verb: string, label: string): ValidationResult => ({
    field,
    severity: "info",
    message: `"${field}" ${verb} by rule "${label}".`,
    rule: "rules",
    manifestPath: input.manifestPath,
    autoFixed: true,
  });
  const warn = (message: string, label: string): ValidationResult => ({
    field: "__rules__",
    severity: "warning",
    message: `Rule "${label}": ${message}`,
    rule: "rule-config",
    manifestPath: input.manifestPath,
    autoFixed: false,
  });

  for (let i = 0; i < input.rules.length; i++) {
    const rule = input.rules[i] as ManifestRule | null | undefined;
    if (!rule || typeof rule !== "object") {
      results.push(warn("not a map.", `#${i + 1}`));
      continue;
    }
    const label = ruleLabel(rule, i);
    const then = rule.then as RuleThen | undefined;
    if (!then || typeof then !== "object" || Array.isArray(then)) {
      results.push(warn("missing then.", label));
      continue;
    }
    const unknownVerb = Object.keys(then).find((k) => !VERBS.has(k));
    if (unknownVerb) {
      results.push(warn(`unknown verb "${unknownVerb}".`, label));
      continue;
    }

    const snapshot = deepClone(working);
    const scratch = deepClone(working);
    const ruleResults: ValidationResult[] = [];
    const env: RuleEnv = {
      app: input.app,
      file: input.file,
      enableJs: input.enableJs,
      self: contextFromFrontmatter(input.file.path, snapshot),
      fields: input.fields,
      now: input.now,
    };

    try {
      if (rule.when !== undefined && !(await evaluateCondition(rule.when, env.self, env))) {
        continue;
      }

      for (const verb of Object.keys(then)) {
        if (verb === "js") {
          const { dv, currentPage } = dataviewContext(input.app, input.file);
          await executeJs(
            then.js as string,
            { fm: scratch, snapshot, file: input.file, app: input.app, dv, currentPage },
            input.enableJs
          );
          for (const key of new Set([...Object.keys(snapshot), ...Object.keys(scratch)])) {
            if (!jsonEqual(snapshot[key], scratch[key])) {
              ruleResults.push(changed(key, "changed", label));
            }
          }
          continue;
        }

        const spec = then[verb as "set" | "add" | "remove"];
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
          throw new RuleConfigError(`"${verb}" needs a map of property to value.`);
        }
        for (const [prop, given] of Object.entries(spec)) {
          const field = input.fields[prop];
          // `{ when }` without a property name selects from the property itself
          const rawValue = isBareFilter(given) ? { [prop]: given } : given;
          if (verb === "set") {
            if (field?.fixed !== undefined) {
              throw new RuleConfigError(`cannot set "${prop}", the field is fixed.`);
            }
            const value = await resolveRuleValue(rawValue, env);
            if (applySet(scratch, prop, value, field))
              ruleResults.push(changed(prop, "set", label));
            continue;
          }
          if (!isListField(field)) {
            throw new RuleConfigError(
              `"${verb}" needs a list field, "${prop}" is "${field?.type}".`
            );
          }
          const resolved = await resolveRuleValue(rawValue, env);
          const values = Array.isArray(resolved) ? resolved : [resolved];
          const didChange =
            verb === "add" ? applyAdd(scratch, prop, values) : applyRemove(scratch, prop, values);
          if (didChange) ruleResults.push(changed(prop, VERB_PAST[verb] ?? verb, label));
        }
      }

      commit(working, scratch);
      // Report only net changes: a remove-then-add of the same items is a no-op
      const seen = new Set<string>();
      for (const r of ruleResults) {
        if (seen.has(r.field) || jsonEqual(snapshot[r.field], scratch[r.field])) continue;
        seen.add(r.field);
        results.push(r);
      }
    } catch (e) {
      if (e instanceof JsDisabledError) {
        results.push({
          field: "__rules__",
          severity: "warning",
          message: `JS validation disabled. Enable "Allow JavaScript execution" in settings to run rule "${label}".`,
          rule: "rules",
          manifestPath: input.manifestPath,
          autoFixed: false,
        });
      } else if (e instanceof RuleConfigError || e instanceof TemplateError) {
        results.push(warn(e.message, label));
      } else {
        results.push(warn(`failed: ${e instanceof Error ? e.message : String(e)}`, label));
      }
    }
  }

  return results;
}
