/** True for a string wrapped in [[ ]] (surrounding whitespace allowed). */
export function isWikiLink(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.startsWith("[[") && s.endsWith("]]");
}

/** `[[path/name#heading|alias]]` → `path/name`; plain strings pass through trimmed. */
export function linkTarget(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("[[")) s = s.slice(2);
  if (s.endsWith("]]")) s = s.slice(0, -2);
  const pipe = s.indexOf("|");
  if (pipe !== -1) s = s.slice(0, pipe);
  // `[[note#heading]]` and `[[note#^block]]` point at the same note
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  return s.replace(/\.md$/, "").trim();
}

/** `[[path/name|alias]]` → `name`. */
export function linkName(raw: string): string {
  const target = linkTarget(raw);
  const slash = target.lastIndexOf("/");
  return slash === -1 ? target : target.slice(slash + 1);
}

/** Frontmatter values are primitives; objects are stringified as JSON so nothing becomes "[object Object]". */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

/** Links compare by note name, everything else by string value. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  const sa = valueText(a);
  const sb = valueText(b);
  if (isWikiLink(sa) || isWikiLink(sb)) return linkName(sa) === linkName(sb);
  return sa === sb;
}
