import type { App, TFile } from "obsidian";
import type { FieldOption, FieldSource } from "../types";
import { executeJsSource, JsDisabledError } from "../utils/js-exec";
import { evaluateQuery } from "./query";

type SourceResolutionStatus = "resolved" | "disabled" | "error";

export interface SourceResolutionResult {
  options: FieldOption[];
  status: SourceResolutionStatus;
  message?: string;
}

export async function resolveSource(
  source: FieldSource,
  app: App,
  currentFile: TFile | null,
  enableJs = false
): Promise<FieldOption[]> {
  return (await resolveSourceWithStatus(source, app, currentFile, enableJs)).options;
}

/**
 * Resolve a picker source without conflating an empty result with a source that
 * could not run. Callers that validate values or render UI should use this
 * variant so disabled/failed JavaScript never becomes an authoritative empty
 * allow-list.
 */
export async function resolveSourceWithStatus(
  source: FieldSource,
  app: App,
  currentFile: TFile | null,
  enableJs = false
): Promise<SourceResolutionResult> {
  if (source.js) {
    return resolveJsSource(source.js, app, currentFile, enableJs);
  }

  const files = app.vault.getMarkdownFiles();

  if (source.query) {
    const q = source.query;
    const filtered = files.filter((f) => {
      const cache = app.metadataCache.getFileCache(f);
      const tags = [
        ...((cache as unknown as { tags?: Array<{ tag: string }> })?.tags?.map(
          (t: { tag: string }) => t.tag
        ) ?? []),
        ...((cache?.frontmatter?.["tags"] as string[] | undefined) ?? []),
      ];
      const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
      return evaluateQuery(q, f.path, tags, fm);
    });
    return {
      options: filtered.map((f) => ({ value: f.basename, label: f.basename })),
      status: "resolved",
    };
  }

  const filtered = files.filter((f) => fileMatchesSource(f, source, app));
  return {
    options: filtered.map((f) => ({ value: f.basename, label: f.basename })),
    status: "resolved",
  };
}

function fileMatchesSource(file: TFile, source: FieldSource, app: App): boolean {
  const conditions: boolean[] = [];

  if (source.folder) {
    conditions.push(file.path.startsWith(source.folder));
  }

  // Fetch file cache once even when both tag and property conditions are present.
  if (source.tag || source.property) {
    const cache = app.metadataCache.getFileCache(file);

    if (source.tag) {
      const tags: string[] =
        (cache as unknown as { tags?: Array<{ tag: string }> })?.tags?.map(
          (t: { tag: string }) => t.tag
        ) ?? [];
      const fmTags = (cache?.frontmatter?.["tags"] as string[] | undefined) ?? [];
      conditions.push(tags.includes(source.tag) || fmTags.includes(source.tag));
    }

    if (source.property) {
      const fm = (cache?.frontmatter ?? {}) as Record<
        string,
        string | number | boolean | null | undefined
      >;
      const allMatch = Object.entries(source.property).every(([k, v]) => {
        const fmVal = fm[k];
        const strVal = fmVal === null || fmVal === undefined ? "" : String(fmVal);
        return strVal === v;
      });
      conditions.push(allMatch);
    }
  }

  if (conditions.length === 0) return false;
  return conditions.every(Boolean);
}

/**
 * Convert a value that may be a DataView Link object, plain string, or primitive
 * to a string we can use as a picker value/label.
 */
function coerceToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // DataView Link objects have a .path property
  if (typeof v === "object" && "path" in v) {
    const path = (v as { path: string }).path;
    // Return bare basename without extension
    return (
      path
        .replace(/\.[^./]+$/, "")
        .split("/")
        .pop() ?? path
    );
  }
  return "";
}

interface JsSourceItem {
  group?: string | number | boolean;
  type?: string;
  value?: string | number | boolean;
  label?: string | number | boolean;
}

interface JsSourceGroup {
  group?: string | number | boolean;
  label?: string | number | boolean;
  type?: string;
  options?: unknown;
}

function normalizeSelectionType(raw: unknown): "select" | "multiselect" | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "select") return "select";
  if (normalized === "multiselect" || normalized === "multi-select") return "multiselect";
  return undefined;
}

function optionFromUnknown(
  item: unknown,
  group?: string,
  type?: "select" | "multiselect"
): FieldOption {
  if (typeof item === "string") {
    return {
      value: item,
      label: item,
      group,
      type,
    };
  }

  const typed = item as JsSourceItem;
  const value = coerceToString(typed.value);
  const label = coerceToString(typed.label ?? typed.value);
  const ownGroup = coerceToString(typed.group);
  const ownType = normalizeSelectionType(typed.type);

  return {
    value,
    label,
    group: ownGroup || group,
    type: ownType ?? type,
  };
}

function toArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return Array.from(result as unknown[]);
  if (typeof result === "string") return [];
  if (result !== null && result !== undefined && Symbol.iterator in Object(result)) {
    return Array.from(result as Iterable<unknown>);
  }
  return [];
}

async function resolveJsSource(
  code: string,
  app: App,
  currentFile: TFile | null,
  enableJs: boolean
): Promise<SourceResolutionResult> {
  const appRecord = app as unknown as Record<string, unknown>;
  // DataView API lives at app.plugins.plugins.dataview.api
  const pluginManager = appRecord["plugins"] as Record<string, unknown> | undefined;
  const pluginsMap = pluginManager?.["plugins"] as Record<string, unknown> | undefined;
  const dataview = pluginsMap?.["dataview"] as Record<string, unknown> | undefined;
  const dv = dataview?.["api"];

  let currentPage: unknown = null;
  if (
    currentFile &&
    dv &&
    typeof dv === "object" &&
    "page" in (dv as Record<string, unknown>) &&
    typeof (dv as { page?: unknown }).page === "function"
  ) {
    try {
      currentPage = (dv as { page: (path: string) => unknown }).page(currentFile.path);
    } catch {
      currentPage = null;
    }
  }

  try {
    const result: unknown = await executeJsSource(
      code,
      app,
      dv,
      currentFile,
      currentPage,
      enableJs
    );
    // dv.pages() returns a DataArray (not a plain Array) — convert any iterable.
    const items = toArray(result);
    if (items.length === 0) return { options: [], status: "resolved" };

    const out: FieldOption[] = [];
    for (const item of items) {
      const maybeGroup = item as JsSourceGroup;
      const nested = toArray(maybeGroup?.options);
      if (nested.length > 0) {
        const group = coerceToString(maybeGroup.group ?? maybeGroup.label);
        const type = normalizeSelectionType(maybeGroup.type);
        for (const sub of nested) {
          out.push(optionFromUnknown(sub, group || undefined, type));
        }
        continue;
      }

      out.push(optionFromUnknown(item));
    }
    return { options: out, status: "resolved" };
  } catch (e) {
    if (e instanceof JsDisabledError) {
      console.warn("[MetadataValidator] JS source skipped: enableJsExecution is disabled.");
      return {
        options: [],
        status: "disabled",
        message: e.message,
      };
    }
    console.error("[MetadataValidator] Error in JS source:", e, "\nCode:", code);
    return {
      options: [],
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
