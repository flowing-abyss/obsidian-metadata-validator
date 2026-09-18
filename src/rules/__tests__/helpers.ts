import type { App, TFile } from "obsidian";
import { contextFromFrontmatter, type RuleEnv } from "../context";

export type VaultFiles = Record<string, Record<string, unknown>>;

function makeFile(path: string): TFile {
  return {
    path,
    basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
    extension: "md",
  } as TFile;
}

/** In-memory vault: `files` maps path → frontmatter. Links resolve by basename or path. */
function makeApp(files: VaultFiles = {}): App {
  const tfiles = Object.keys(files).map(makeFile);
  return {
    metadataCache: {
      getFirstLinkpathDest: (name: string) =>
        tfiles.find((f) => f.basename === name || f.path === name + ".md" || f.path === name) ??
        null,
      getFileCache: (f: TFile) => (files[f.path] ? { frontmatter: files[f.path], tags: [] } : null),
    },
    vault: { getMarkdownFiles: () => tfiles },
  } as unknown as App;
}

export function makeEnv(
  fm: Record<string, unknown>,
  files: VaultFiles = {},
  enableJs = false,
  now: () => Date = () => new Date("2026-09-18T12:00:00+07:00")
): RuleEnv {
  const app = makeApp(files);
  const file = makeFile("notes/self.md");
  return { app, file, enableJs, self: contextFromFrontmatter(file.path, fm), fields: {}, now };
}
