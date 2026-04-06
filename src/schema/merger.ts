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
  return {
    name: child.name ?? parent.name,
    description: child.description ?? parent.description,
    priority: child.priority ?? parent.priority,
    extends: child.extends,
    enforce_folder: child.enforce_folder ?? parent.enforce_folder,
    target: child.target && Object.keys(child.target).length > 0 ? child.target : parent.target,
    fields: {
      ...(parent.fields ?? {}),
      ...(child.fields ?? {}),
    },
    formatting: child.formatting ?? parent.formatting,
  };
}
