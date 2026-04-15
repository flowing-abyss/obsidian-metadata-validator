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

  // required: auto-insert null placeholder so the field key appears in frontmatter
  // Only when the key is completely absent (undefined); explicit null is left as-is
  if (
    field.required &&
    field.default === undefined &&
    field.fixed === undefined &&
    current === undefined
  ) {
    frontmatter[fieldName] = null;
    changed = true;
  }

  // list: if the current value is a non-null scalar, wrap it in an array
  const postFix = frontmatter[fieldName];
  if (
    field.type === "list" &&
    postFix !== undefined &&
    postFix !== null &&
    !Array.isArray(postFix)
  ) {
    frontmatter[fieldName] = [postFix];
    changed = true;
  }

  // sort: alphabetical / alphabetical-desc
  if (
    (field.sort === "alphabetical" || field.sort === "alphabetical-desc") &&
    Array.isArray(frontmatter[fieldName])
  ) {
    const arr = frontmatter[fieldName] as unknown[];
    const asc = field.sort === "alphabetical";
    const sorted = [...arr].sort((a, b) =>
      asc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a))
    );
    if (sorted.some((v, i) => v !== arr[i])) {
      frontmatter[fieldName] = sorted;
      changed = true;
    }
  }

  return changed;
}
