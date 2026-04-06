/**
 * Evaluate a target expression against a note.
 *
 * Syntax (case-insensitive operators):
 *   term           →  a single condition
 *   term AND term  →  both must be true (higher precedence)
 *   term OR term   →  either must be true
 *
 * Terms:
 *   "folder/"   or  folder/   →  note path starts with this prefix
 *   #tag                      →  note has this tag (or a child tag)
 *   key=value                 →  frontmatter[key] === value
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

  // Property: key=value
  const eqIdx = term.indexOf("=");
  if (eqIdx !== -1 && !term.startsWith('"') && !term.startsWith("'")) {
    const key = term.slice(0, eqIdx).trim();
    const val = term
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    const fmVal = frontmatter[key];
    return (
      (fmVal === null || fmVal === undefined ? "" : String(fmVal as string | number | boolean)) ===
      val
    );
  }

  // Folder: ends with / (with or without quotes)
  const folderRaw = term.replace(/^["']|["']$/g, "");
  if (folderRaw.endsWith("/")) {
    return filePath.startsWith(folderRaw);
  }

  return false;
}
