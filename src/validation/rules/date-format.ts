import type { ValidationResult } from "../../types";

/**
 * Build a regex that matches the structural shape of a date format string.
 * Tokens: YYYY → 4 digits, MM → 2 digits, DD → 2 digits, M/D → 1-2 digits.
 * Other characters (-, /, .) are escaped and kept literal.
 */
function buildFormatRegex(format: string): RegExp {
  let pattern = "";
  let i = 0;
  while (i < format.length) {
    if (format.startsWith("YYYY", i)) {
      pattern += "\\d{4}";
      i += 4;
    } else if (format.startsWith("YY", i)) {
      pattern += "\\d{2}";
      i += 2;
    } else if (format.startsWith("MM", i)) {
      pattern += "\\d{2}";
      i += 2;
    } else if (format.startsWith("DD", i)) {
      pattern += "\\d{2}";
      i += 2;
    } else if (format[i] === "M" || format[i] === "D") {
      pattern += "\\d{1,2}";
      i++;
    } else {
      // Escape regex metacharacters
      pattern += (format[i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp("^" + pattern + "$");
}

/**
 * Extract numeric year/month/day from a date string using the format as a guide.
 * Supports: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD.MM.YYYY and their variants.
 * Returns null if the format is unrecognised.
 */
function extractYMD(str: string, format: string): [number, number, number] | null {
  const yIdx = format.indexOf("YYYY");
  const mIdx = format.indexOf("MM");
  const dIdx = format.indexOf("DD");
  if (yIdx === -1 || mIdx === -1 || dIdx === -1) return null;

  // Use separator(s) between tokens to split
  const sep = format
    .replace(/YYYY|MM|DD|YY|M|D/g, "\0")
    .replace(/\0+/g, "\0")
    .slice(1, -1);
  const firstSep = sep[0] ?? "";
  const parts = firstSep ? str.split(firstSep) : null;
  if (!parts || parts.length < 3) return null;

  // Determine which position each token occupies by order in the format
  const positions = [
    { label: "Y", idx: yIdx },
    { label: "M", idx: mIdx },
    { label: "D", idx: dIdx },
  ].sort((a, b) => a.idx - b.idx);

  const map: Record<string, number> = {};
  positions.forEach((p, i) => {
    map[p.label] = Number(parts[i] ?? 0);
  });

  const year = map["Y"] ?? 0;
  const month = map["M"] ?? 0;
  const day = map["D"] ?? 0;
  return [year, month, day];
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function checkDateFormat(
  field: string,
  value: unknown,
  format: string | undefined,
  manifestPath: string
): ValidationResult | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const str = String(value).trim();
  if (!str) return null;

  if (format) {
    const regex = buildFormatRegex(format);
    if (!regex.test(str)) {
      return {
        field,
        severity: "error",
        message: `"${field}" must match date format "${format}" (got "${str}").`,
        rule: "date-format",
        manifestPath,
        autoFixed: false,
      };
    }

    const ymd = extractYMD(str, format);
    if (ymd) {
      const [y, m, d] = ymd;
      if (!isCalendarDate(y, m, d)) {
        return {
          field,
          severity: "error",
          message: `"${field}" is not a valid calendar date: "${str}".`,
          rule: "date-format",
          manifestPath,
          autoFixed: false,
        };
      }
    }
  } else {
    // No format — warn if the value is clearly not a date
    if (isNaN(Date.parse(str))) {
      return {
        field,
        severity: "warning",
        message: `"${field}" doesn't look like a valid date: "${str}".`,
        rule: "date-format",
        manifestPath,
        autoFixed: false,
      };
    }
  }

  return null;
}
