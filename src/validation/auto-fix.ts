import type { ManifestField } from "../types";

/**
 * Apply deterministic auto-fixes for a single field.
 * Mutates the frontmatter object in place.
 * Returns true if a change was made.
 */
export function applyAutoFix(
  fieldName: string,
  field: ManifestField,
  frontmatter: Record<string, unknown>
): boolean {
  let changed = false;
  const current = frontmatter[fieldName];

  // fixed: always overwrite
  if (field.fixed !== undefined) {
    if (current !== field.fixed) {
      frontmatter[fieldName] = field.fixed;
      changed = true;
    }
    return changed;
  }

  // default: insert only if empty
  if (field.default !== undefined) {
    const isEmpty =
      current === undefined ||
      current === null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (isEmpty) {
      frontmatter[fieldName] = field.default;
      changed = true;
    }
  }

  // sort: alphabetical
  if (field.sort === "alphabetical" && Array.isArray(frontmatter[fieldName])) {
    const arr = frontmatter[fieldName] as unknown[];
    const sorted = [...arr].sort((a, b) => String(a).localeCompare(String(b)));
    if (sorted.some((v, i) => v !== arr[i])) {
      frontmatter[fieldName] = sorted;
      changed = true;
    }
  }

  return changed;
}
