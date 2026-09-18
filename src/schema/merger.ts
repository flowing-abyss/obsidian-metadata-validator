import type { ManifestData, ManifestRule } from "../types";

/**
 * Merge parent and child ManifestData.
 * Rules:
 * - fields: child fields entirely replace same-named parent fields (no deep merge)
 * - fields: parent fields not in child are inherited as-is
 * - formatting: child overrides parent if present
 * - target: always the child's own (never inherited)
 * - name, description, priority, extends: always child's own
 * - rules: not merged here; the resolver orders them (see SchemaResolver.collectRules)
 */
export function mergeSchemas(parent: ManifestData, child: ManifestData): ManifestData {
  const mergedFields: Record<string, import("../types").ManifestField> = {
    ...(parent.fields ?? {}),
    ...(child.fields ?? {}),
  };

  // Remove fields the child explicitly excludes from the parent
  for (const key of child.exclude ?? []) {
    delete mergedFields[key];
  }

  return {
    name: child.name ?? parent.name,
    description: child.description ?? parent.description,
    priority: child.priority ?? parent.priority,
    extends: child.extends,
    exclude: child.exclude,
    enforce_folder: child.enforce_folder ?? parent.enforce_folder,
    target: child.target && Object.keys(child.target).length > 0 ? child.target : parent.target,
    fields: mergedFields,
    formatting: child.formatting ?? parent.formatting,
  };
}

/**
 * Append `child` rules after `parent` rules. A child rule whose `name` matches
 * a parent rule replaces it in the parent's position. Names in `exclude` are dropped.
 * A `rules:` value that is not a list (hand-written YAML) contributes nothing.
 */
export function mergeRules(
  parent: ManifestRule[],
  child: unknown,
  exclude?: string[]
): ManifestRule[] {
  const out = [...parent];
  const children = Array.isArray(child) ? (child as unknown[]) : [];
  for (const item of children) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const rule = item as ManifestRule;
    const idx = rule.name ? out.findIndex((r) => r.name === rule.name) : -1;
    if (idx === -1) out.push(rule);
    else out[idx] = rule;
  }
  const dropped = new Set(exclude ?? []);
  return out.filter((r) => !r.name || !dropped.has(r.name));
}
