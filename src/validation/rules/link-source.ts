import type { FieldOption, ValidationResult } from "../../types";

export function checkLinkSource(
  field: string,
  value: unknown,
  allowedOptions: FieldOption[],
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;

  const allowed = new Set(allowedOptions.map((o) => o.value));
  // Normalise a stored wikilink to a bare basename for comparison.
  // Handles: plain text, [[name]], [[path/name]], [[path/name|alias]]
  const strip = (v: unknown): string => {
    let s = String(v).trim();
    if (s.startsWith("[[")) s = s.slice(2);
    if (s.endsWith("]]")) s = s.slice(0, -2);
    // Strip alias — keep the link target (more reliable than trusting the alias text)
    const pipe = s.indexOf("|");
    if (pipe !== -1) s = s.slice(0, pipe);
    // Strip folder path — keep only the basename so "path/Name" matches option "Name"
    const slash = s.lastIndexOf("/");
    if (slash !== -1) s = s.slice(slash + 1);
    return s.trim();
  };
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter((v) => !allowed.has(strip(v)));

  if (invalid.length === 0) return null;

  return {
    field,
    severity: "error",
    message: `"${field}" links to note(s) not in allowed source: ${invalid.map((v) => `"${String(v)}"`).join(", ")}.`,
    rule: "link-source",
    manifestPath,
    autoFixed: false,
  };
}
