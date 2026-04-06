import type { TFile } from "obsidian";
import type { Manifest, ManifestData, ResolvedSchema } from "../types";
import type { ManifestCache } from "../manifest/cache";
import { mergeSchemas } from "./merger";

export class SchemaResolver {
  private resolved: Map<string, ResolvedSchema> = new Map();
  private cache: ManifestCache;

  constructor(cache: ManifestCache) {
    this.cache = cache;
  }

  setCache(cache: ManifestCache): void {
    this.cache = cache;
  }

  rebuild(): void {
    this.resolved.clear();
    for (const manifest of this.cache.getAll()) {
      const schema = this.resolve(manifest, new Set());
      if (schema) this.resolved.set(manifest.path, schema);
    }
  }

  private resolve(manifest: Manifest, visiting: Set<string>): ResolvedSchema | null {
    if (visiting.has(manifest.path)) {
      console.warn(`[MetadataValidator] Circular inheritance detected at ${manifest.path}`);
      return null;
    }
    visiting.add(manifest.path);

    const parent = this.findParent(manifest);
    if (!parent) {
      return this.toResolved(manifest, manifest.data, [manifest.path]);
    }

    const parentSchema = this.resolve(parent, visiting);
    if (!parentSchema) return null;

    const mergedData = mergeSchemas(parent.data, manifest.data);
    const chain = [...parentSchema.inheritanceChain, manifest.path];
    return this.toResolved(manifest, mergedData, chain);
  }

  private findParent(manifest: Manifest): Manifest | null {
    if (manifest.data.extends) {
      const explicitPath = manifest.data.extends.replace(/\/+$/, "");
      const found =
        this.cache.getByFolder(explicitPath) ??
        this.cache.getByFolder(explicitPath.replace(/\/manifest\.md$/, ""));
      return found ?? null;
    }

    const parts = manifest.folderPath.split("/");
    if (parts.length <= 1) return null;
    const parentFolder = parts.slice(0, -1).join("/");
    return this.cache.getByFolder(parentFolder) ?? null;
  }

  private toResolved(manifest: Manifest, data: ManifestData, chain: string[]): ResolvedSchema {
    return {
      manifestPath: manifest.path,
      name: data.name ?? manifest.folderPath.split("/").pop() ?? "unknown",
      priority: data.priority ?? 0,
      enforce_folder: data.enforce_folder,
      target: data.target ?? {},
      fields: data.fields ?? {},
      formatting: data.formatting ?? {},
      inheritanceChain: chain,
    };
  }

  resolveForNote(file: TFile, frontmatter: Record<string, unknown>): ResolvedSchema | null {
    const fileTags: string[] = (file as unknown as { tags?: string[] }).tags ?? [];
    const matches: ResolvedSchema[] = [];

    for (const schema of this.resolved.values()) {
      if (this.matchesTarget(file, fileTags, frontmatter, schema)) {
        matches.push(schema);
      }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0] ?? null;

    matches.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return targetSpecificity(b.target) - targetSpecificity(a.target);
    });
    return matches[0] ?? null;
  }

  private matchesTarget(
    file: TFile,
    fileTags: string[],
    frontmatter: Record<string, unknown>,
    schema: ResolvedSchema
  ): boolean {
    const { target } = schema;
    if (!target) return false;

    const conditions: boolean[] = [];

    if (target.folder) {
      conditions.push(file.path.startsWith(target.folder));
    }
    if (target.tag) {
      conditions.push(fileTags.includes(target.tag));
    }
    if (target.property) {
      const allMatch = Object.entries(target.property).every(([k, v]) => {
        const fmVal = frontmatter[k];
        const strVal =
          fmVal === null || fmVal === undefined ? "" : String(fmVal as string | number | boolean);
        return strVal === v;
      });
      conditions.push(allMatch);
    }

    if (conditions.length === 0) return false;

    return target.op === "OR" ? conditions.some(Boolean) : conditions.every(Boolean);
  }
}

function targetSpecificity(target: ResolvedSchema["target"]): number {
  return (target.folder ? 1 : 0) + (target.tag ? 1 : 0) + (target.property ? 1 : 0);
}
