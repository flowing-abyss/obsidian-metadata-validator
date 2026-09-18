import { moment } from "../utils/dates";
import { isWikiLink, linkName, valueText } from "./link-text";

export interface TemplateContext {
  frontmatter: Record<string, unknown>;
  file: { name: string; path: string; folder: string };
  /** Injectable clock for tests */
  now?: () => Date;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const LIST_MARK = "\u0000";

export function hasTemplate(s: string): boolean {
  return /\{\{[^{}]+\}\}/.test(s);
}

/** Exactly one placeholder and nothing else → raw value; otherwise rendered text. */
export function renderValue(s: string, ctx: TemplateContext): unknown {
  const exact = /^\s*\{\{([^{}]+)\}\}\s*$/.exec(s);
  if (exact?.[1]) {
    const v = evaluatePlaceholder(exact[1], ctx);
    return v === undefined || v === "" ? null : v;
  }
  return renderText(s, ctx);
}

/**
 * Render placeholders inside text. A list-valued placeholder expands into one
 * string per element. An empty placeholder makes the whole text `null`, so
 * `category/{{category}}` on a note without a category yields nothing rather
 * than the junk value `category/`.
 */
export function renderText(s: string, ctx: TemplateContext): string | string[] | null {
  let listValues: string[] | null = null;
  let empty = false;
  const rendered = s.replace(PLACEHOLDER, (_m, expr: string) => {
    const v = evaluatePlaceholder(expr, ctx);
    if (Array.isArray(v)) {
      if (listValues) throw new TemplateError("At most one list-valued placeholder per string.");
      listValues = v.map(valueText);
      return LIST_MARK;
    }
    if (v === null || v === undefined || v === "") empty = true;
    return valueText(v);
  });
  if (empty) return null;
  if (listValues === null) return rendered;
  return (listValues as string[]).map((item) => rendered.replace(LIST_MARK, item));
}

/** Replace placeholders in a query string, quoting rendered values that contain spaces or quotes. */
export function expandTemplatesInQuery(query: string, ctx: TemplateContext): string {
  return query.replace(PLACEHOLDER, (_m, expr: string) => {
    const v = evaluatePlaceholder(expr, ctx);
    const text = Array.isArray(v) ? v.map(valueText).join(",") : valueText(v);
    return /[\s"'()]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
  });
}

function evaluatePlaceholder(expr: string, ctx: TemplateContext): unknown {
  const parts = splitPipes(expr);
  const head = (parts.shift() ?? "").trim();
  let value = lookup(head, ctx);
  for (const filter of parts) value = applyFilter(filter.trim(), value);
  return value;
}

function lookup(name: string, ctx: TemplateContext): unknown {
  const now = ctx.now?.() ?? new Date();
  switch (name) {
    case "today":
      return moment(now).format("YYYY-MM-DD");
    case "now":
      return moment(now).format();
    case "file.name":
      return ctx.file.name;
    case "file.path":
      return ctx.file.path;
    case "file.folder":
      return ctx.file.folder;
    default:
      return ctx.frontmatter[name];
  }
}

/** Split on `|` outside quotes. */
function splitPipes(expr: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  for (const ch of expr) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "|") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseFilter(spec: string): { name: string; args: string[] } {
  const colon = spec.indexOf(":");
  if (colon === -1) return { name: spec, args: [] };
  const name = spec.slice(0, colon).trim();
  const rest = spec.slice(colon + 1);
  const args: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    args.push(m[3] !== undefined ? raw.trim() : raw.replace(/\\(["'])/g, "$1"));
  }
  return { name, args };
}

type StringFn = (s: string) => string;

function mapText(value: unknown, fn: StringFn): unknown {
  if (Array.isArray(value)) return value.map((v) => fn(valueText(v)));
  if (value === null || value === undefined) return value;
  return fn(valueText(value));
}

function applyFilter(spec: string, value: unknown): unknown {
  const { name, args } = parseFilter(spec);
  switch (name) {
    case "join": {
      const list = Array.isArray(value)
        ? value
        : value === null || value === undefined
          ? []
          : [value];
      return list.map(valueText).join(args[0] ?? ", ");
    }
    case "name":
      return mapText(value, (s) => (isWikiLink(s) ? linkName(s) : s));
    case "snake":
      return mapText(value, (s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      );
    case "kebab":
      return mapText(value, (s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[\s_]+/g, "-")
      );
    case "lower":
      return mapText(value, (s) => s.toLowerCase());
    case "upper":
      return mapText(value, (s) => s.toUpperCase());
    case "trim":
      return mapText(value, (s) => s.trim());
    case "replace":
      return mapText(value, (s) => (args[0] ? s.split(args[0]).join(args[1] ?? "") : s));
    case "date":
      return mapText(value, (s) => {
        const parsed = moment(s, moment.ISO_8601, true);
        return parsed.isValid() ? parsed.format(args[0] ?? "YYYY-MM-DD") : s;
      });
    default:
      throw new TemplateError(`Unknown template filter "${name}".`);
  }
}
