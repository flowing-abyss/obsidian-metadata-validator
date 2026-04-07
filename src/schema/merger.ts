import type { ManifestData } from "../types";

/**
 * Merge parent and child ManifestData.
 * Rules:
 * - fields: child fields entirely replace same-named parent fields (no deep merge)
 * - fields: parent fields not in child are inherited as-is
 * - formatting: child overrides parent if present
 * - target: always the child's own (never inherited)
 * - name, description, priority, extends: always child's own
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
