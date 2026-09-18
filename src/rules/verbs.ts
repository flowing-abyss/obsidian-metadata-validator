import type { ManifestField, RuleValue } from "../types";
import { dataviewContext, executeJs } from "../utils/js-exec";
import type { RuleEnv } from "./context";
import { templateContextOf } from "./context";
import { isWikiLink, linkName, valuesEqual, valueText } from "./link-text";
import { isSelection, resolveSelection } from "./selection";
import { hasTemplate, renderValue } from "./template";

const LIST_TYPES = new Set(["list", "multiselect", "multilink"]);

/** `add` and `remove` need a list; undeclared properties are treated as lists. */
export function isListField(field: ManifestField | undefined): boolean {
  return field === undefined || LIST_TYPES.has(field.type);
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function isJsValue(v: unknown): v is { js: string } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as { js?: unknown }).js === "string" &&
    Object.keys(v).length === 1
  );
}

/** Resolve a value slot: literal, template, selection, `{ js }`, or an array of those (flattened). */
export async function resolveRuleValue(value: RuleValue, env: RuleEnv): Promise<unknown> {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = await resolveRuleValue(item, env);
      if (Array.isArray(r)) out.push(...(r as unknown[]));
      else if (!isEmpty(r)) out.push(r);
    }
    return out;
  }
  if (typeof value === "string") {
    return hasTemplate(value) ? renderValue(value, templateContextOf(env)) : value;
  }
  if (isJsValue(value)) {
    const { dv, currentPage } = dataviewContext(env.app, env.file);
    return executeJs(
      value.js,
      { fm: env.self.frontmatter, file: env.file, app: env.app, dv, currentPage },
      env.enableJs
    );
  }
  if (isSelection(value)) return resolveSelection(value, env.self, env);
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  return a === b;
}

/** Write `value`; the shape follows the field type. Returns true when the property changed. */
export function applySet(
  working: Record<string, unknown>,
  prop: string,
  value: unknown,
  field?: ManifestField
): boolean {
  let next = value;
  if (field && !LIST_TYPES.has(field.type) && Array.isArray(value)) {
    next = value.length === 0 ? null : value.length === 1 ? value[0] : value;
  } else if (field && LIST_TYPES.has(field.type) && !Array.isArray(value) && !isEmpty(value)) {
    next = [value];
  }
  if (next === undefined) next = null;
  if (sameValue(working[prop], next)) return false;
  working[prop] = next;
  return true;
}

function toList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return isEmpty(v) ? [] : [v];
}

/** Append values not already present (links compare by name). Keeps identity when unchanged. */
export function applyAdd(
  working: Record<string, unknown>,
  prop: string,
  values: unknown[]
): boolean {
  const current = toList(working[prop]);
  const additions = values.filter(
    (v, i, arr) =>
      !isEmpty(v) &&
      !current.some((c) => valuesEqual(c, v)) &&
      arr.findIndex((o) => valuesEqual(o, v)) === i
  );
  if (additions.length === 0) return false;
  working[prop] = [...current, ...additions];
  return true;
}

function maskToRegex(mask: string): RegExp {
  const escaped = mask.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(value: unknown, pattern: unknown): boolean {
  if (typeof pattern === "string" && pattern.includes("*") && !isWikiLink(pattern)) {
    const text = isWikiLink(value) ? linkName(value) : valueText(value);
    return maskToRegex(pattern).test(text);
  }
  return valuesEqual(value, pattern);
}

/** Remove matching items (literal, `*` mask, or link by name). Keeps identity when unchanged. */
export function applyRemove(
  working: Record<string, unknown>,
  prop: string,
  patterns: unknown[]
): boolean {
  if (!Array.isArray(working[prop])) return false;
  const current = working[prop] as unknown[];
  const kept = current.filter((v) => !patterns.some((p) => matchesPattern(v, p)));
  if (kept.length === current.length) return false;
  working[prop] = kept;
  return true;
}
