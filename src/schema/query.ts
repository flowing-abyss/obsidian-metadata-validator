import { valuesEqual, valueText } from "../rules/link-text";

/**
 * Evaluate a target expression against a note.
 *
 * Syntax (case-insensitive operators):
 *   term           →  a single condition
 *   -term / NOT term → negates a term (highest precedence)
 *   term AND term  →  both must be true (higher precedence)
 *   term OR term   →  either must be true
 *   ( ... )        →  grouping
 *
 * Terms:
 *   "folder/"   or  folder/   →  note path starts with this prefix
 *   #tag                      →  note has this tag (or a child tag)
 *   key=value                 →  frontmatter[key] equals value (a list: contains value)
 *   key=                      →  frontmatter[key] is empty (null, "", [] or absent)
 *   key<value, key>value, key<=value, key>=value → typed comparison (number, date, string)
 *   {{...}} on the right-hand side is expanded by the rules engine before evaluation
 *
 * Example:  "Sources/" AND #book
 */
export function evaluateQuery(
  query: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>
): boolean {
  // Split into OR groups first (lowest precedence)
  const orGroups = splitOuter(query, " OR ");
  return orGroups.some((group) => {
    const andTerms = splitOuter(group, " AND ");
    return andTerms.every((term) => evaluateTerm(term.trim(), filePath, fileTags, frontmatter));
  });
}

/** Split a string on `sep` but only at the top level (not inside quotes) */
function splitOuter(input: string, sep: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";
  let start = 0;
  const s = input.toUpperCase();
  const sepUpper = sep.toUpperCase();

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (depth === 0 && s.startsWith(sepUpper, i)) {
      results.push(input.slice(start, i).trim());
      i += sep.length - 1;
      start = i + 1;
    }
  }
  results.push(input.slice(start).trim());
  return results.filter(Boolean);
}

function evaluateTerm(
  raw: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>
): boolean {
  const { term, negate } = consumeNegationPrefixes(raw);
  if (!term) return false;
  const matches = evaluateBaseTerm(term, filePath, fileTags, frontmatter);
  return negate ? !matches : matches;
}

function consumeNegationPrefixes(raw: string): { term: string; negate: boolean } {
  let term = raw.trim();
  let negate = false;

  while (term) {
    if (term.startsWith("-")) {
      negate = !negate;
      term = term.slice(1).trim();
      continue;
    }

    if (/^NOT\s+/i.test(term)) {
      negate = !negate;
      term = term.slice(3).trim();
      continue;
    }

    break;
  }

  return { term, negate };
}

function evaluateBaseTerm(
  raw: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>
): boolean {
  // Strip optional outer parentheses
  let term = raw;
  if (term.startsWith("(") && term.endsWith(")")) {
    term = term.slice(1, -1).trim();
    return evaluateQuery(term, filePath, fileTags, frontmatter);
  }

  // Tag: starts with #
  if (term.startsWith("#")) {
    const tagName = term.slice(1).toLowerCase();
    return fileTags.some((t) => {
      const ft = t.replace(/^#/, "").toLowerCase();
      return ft === tagName || ft.startsWith(tagName + "/");
    });
  }

  // Property term: key<op>value  (op: =, <, >, <=, >=). An empty value means "is empty".
  const termMatch = /^([^<>=#"'][^<>=]*?)\s*(<=|>=|<|>|=)\s*([\s\S]*)$/.exec(term);
  if (termMatch) {
    const key = (termMatch[1] ?? "").trim();
    const op = termMatch[2] ?? "=";
    const val = unquote((termMatch[3] ?? "").trim());
    return evaluatePropertyTerm(frontmatter[key], op, val);
  }

  // Folder: ends with / (with or without quotes)
  const folderRaw = term.replace(/^["']|["']$/g, "");
  if (folderRaw.endsWith("/")) {
    return filePath.startsWith(folderRaw);
  }

  return false;
}

function unquote(raw: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/.exec(raw);
  if (!quoted) return raw;
  return (quoted[1] ?? quoted[2] ?? "").replace(/\\(["'])/g, "$1");
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function evaluatePropertyTerm(fmVal: unknown, op: string, val: string): boolean {
  if (op === "=") {
    if (val === "") return isEmptyValue(fmVal);
    if (isEmptyValue(fmVal)) return false;
    const values = Array.isArray(fmVal) ? fmVal : [fmVal];
    return values.some((v) => valuesEqual(v, val));
  }
  if (isEmptyValue(fmVal) || val === "") return false;
  const values = Array.isArray(fmVal) ? fmVal : [fmVal];
  return values.some((v) => {
    const cmp = compareValues(v, val);
    if (cmp === null) return false;
    switch (op) {
      case "<":
        return cmp < 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      default:
        return cmp >= 0;
    }
  });
}

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Numeric if both numeric, date if both ISO dates (coarser precision wins), else string. */
function compareValues(a: unknown, b: string): number | null {
  const sa = valueText(a).trim();
  const sb = b.trim();
  if (sa === "" || sb === "") return null;
  const na = Number(sa);
  const nb = Number(sb);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  if (DATE_RE.test(sa) && DATE_RE.test(sb)) {
    if (sa.length === 10 || sb.length === 10) {
      const da = sa.slice(0, 10);
      const db = sb.slice(0, 10);
      return da === db ? 0 : da < db ? -1 : 1;
    }
    const ta = Date.parse(sa);
    const tb = Date.parse(sb);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  }
  return sa.localeCompare(sb);
}
