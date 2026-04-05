import type { App, TFile } from "obsidian";
import type { FieldOption, FieldSource } from "../types";

export async function resolveSource(
  source: FieldSource,
  app: App,
  currentFile: TFile | null
): Promise<FieldOption[]> {
  if (source.js) {
    return resolveJsSource(source.js, app, currentFile);
  }

  const files = app.vault.getMarkdownFiles();
  const filtered = files.filter((f) => fileMatchesSource(f, source, app));
  return filtered.map((f) => ({ value: f.basename, label: f.basename }));
}

function fileMatchesSource(file: TFile, source: FieldSource, app: App): boolean {
  const conditions: boolean[] = [];

  if (source.folder) {
    conditions.push(file.path.startsWith(source.folder));
  }
  if (source.tag) {
    const cache = app.metadataCache.getFileCache(file);
    const tags: string[] =
      (cache as unknown as { tags?: Array<{ tag: string }> })?.tags?.map(
        (t: { tag: string }) => t.tag
      ) ?? [];
    const fmTags = (cache?.frontmatter?.["tags"] as string[] | undefined) ?? [];
    conditions.push(tags.includes(source.tag) || fmTags.includes(source.tag));
  }
  if (source.property) {
    const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
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

  if (conditions.length === 0) return false;
  return conditions.every(Boolean);
}

interface JsSourceItem {
  value?: string | number | boolean;
  label?: string | number | boolean;
}

async function resolveJsSource(
  code: string,
  app: App,
  currentFile: TFile | null
): Promise<FieldOption[]> {
  const appRecord = app as unknown as Record<string, unknown>;
  const plugins = appRecord["plugins"] as Record<string, unknown> | undefined;
  const dataview = plugins?.["dataview"] as Record<string, unknown> | undefined;
  const dv = dataview?.["api"];

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("app", "dv", "current", code) as (
      app: App,
      dv: unknown,
      current: TFile | null
    ) => unknown;
    const result: unknown = await fn(app, dv, currentFile);
    if (!Array.isArray(result)) return [];
    return (result as unknown[]).map((item) => {
      if (typeof item === "string") return { value: item, label: item };
      const typed = item as JsSourceItem;
      const value = String(typed.value ?? "");
      const label = String(typed.label ?? typed.value ?? "");
      return { value, label };
    });
  } catch (e) {
    console.error("[MetadataValidator] Error in JS source:", e);
    return [];
  }
}
