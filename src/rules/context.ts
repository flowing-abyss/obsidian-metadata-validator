import type { App, TFile } from "obsidian";
import type { ManifestField } from "../types";
import { valueText } from "./link-text";
import type { TemplateContext } from "./template";

/** What a condition sees: the note's path, tags and frontmatter. */
export interface NoteContext {
  path: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
}

/** Everything a rule needs while running for one note. */
export interface RuleEnv {
  app: App;
  file: TFile;
  enableJs: boolean;
  /** The rule's own note — templates always refer to it */
  self: NoteContext;
  fields: Record<string, ManifestField>;
  now?: () => Date;
}

/** Frontmatter tags as bare names, whatever shape the user wrote them in. */
function tagsOf(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter["tags"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
  return list
    .filter((t) => t !== null && t !== undefined && t !== "")
    .map((t) => valueText(t).replace(/^#/, ""));
}

export function contextFromFrontmatter(
  path: string,
  frontmatter: Record<string, unknown>
): NoteContext {
  return { path, tags: tagsOf(frontmatter), frontmatter };
}

/** Context of another note from the metadata cache (frontmatter + inline tags). */
export function contextForFile(file: TFile, app: App): NoteContext {
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter: Record<string, unknown> = { ...(cache?.frontmatter ?? {}) };
  delete frontmatter["position"];
  const inline = (cache?.tags ?? []).map((t) => t.tag.replace(/^#/, ""));
  const tags = Array.from(new Set([...tagsOf(frontmatter), ...inline]));
  return { path: file.path, tags, frontmatter };
}

export function templateContextOf(env: RuleEnv): TemplateContext {
  const path = env.self.path;
  const slash = path.lastIndexOf("/");
  return {
    frontmatter: env.self.frontmatter,
    file: {
      name: env.file.basename,
      path,
      folder: slash === -1 ? "" : path.slice(0, slash),
    },
    now: env.now,
  };
}
