import { parseYaml as obsidianParseYaml } from "obsidian";
import type { ManifestData } from "../types";

/**
 * Parse raw markdown file content into ManifestData.
 * Extracts YAML frontmatter only; ignores the file body.
 * Returns {} if no valid frontmatter is found.
 */
export function parseManifest(fileContent: string): ManifestData {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};

  const yaml = match[1].trim();
  if (!yaml) return {};

  try {
    const result = obsidianParseYaml(yaml) as ManifestData | null;
    return result ?? {};
  } catch {
    return parseMinimal(yaml) as ManifestData;
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML fallback (used in test environment where obsidian is mocked)
// Handles: strings, numbers, booleans, null, block arrays, nested objects,
// and YAML flow sequences [a, b, c].
// ---------------------------------------------------------------------------

function parseMinimal(yaml: string): unknown {
  const lines = yaml.split(/\r?\n/);
  return parseObject(lines, 0, 0).value;
}

type ParseResult = { value: unknown; nextLine: number };

function parseObject(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) break;

    const key = line.slice(indent, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === "" || rest === "|" || rest === ">") {
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent) {
          if (nextLine.trim().startsWith("- ")) {
            const arrResult = parseArray(lines, i, nextIndent);
            obj[key] = arrResult.value;
            i = arrResult.nextLine;
          } else {
            const subResult = parseObject(lines, i, nextIndent);
            obj[key] = subResult.value;
            i = subResult.nextLine;
          }
        } else {
          obj[key] = null;
        }
      }
    } else if (rest.startsWith("- ")) {
      const arrResult = parseArray([rest.trim(), ...lines.slice(i + 1)], 0, 0);
      obj[key] = arrResult.value;
      i += arrResult.nextLine;
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: obj, nextLine: i };
}

function parseArray(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < baseIndent) break;

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) break;

    const itemContent = trimmed.slice(2).trim();
    if (itemContent === "") {
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent) {
          const subResult = parseObject(lines, i, nextIndent);
          arr.push(subResult.value);
          i = subResult.nextLine;
        }
      }
    } else if (itemContent.includes(":")) {
      const subResult = parseObject([itemContent, ...lines.slice(i + 1)], 0, 0);
      const subVal = subResult.value as Record<string, unknown>;
      i++;
      if (i < lines.length) {
        const nextLine = lines[i] ?? "";
        const nextIndent = getIndent(nextLine);
        if (nextIndent > baseIndent + 2) {
          const moreResult = parseObject(lines, i, nextIndent);
          arr.push({ ...subVal, ...(moreResult.value as Record<string, unknown>) });
          i = moreResult.nextLine;
        } else {
          arr.push(subVal);
        }
      } else {
        arr.push(subVal);
      }
    } else {
      arr.push(parseScalar(itemContent));
      i++;
    }
  }

  return { value: arr, nextLine: i };
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // YAML flow sequence: [a, b, c]
  if (s.startsWith("[") && s.endsWith("]")) {
    return s
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item.trim()))
      .filter((item) => item !== "");
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}
