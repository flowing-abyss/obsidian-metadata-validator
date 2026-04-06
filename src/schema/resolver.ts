import type { TFile } from "obsidian";
import type { Manifest, ManifestData, ResolvedSchema } from "../types";
import type { ManifestCache } from "../manifest/cache";
import { mergeSchemas } from "./merger";
import { evaluateQuery } from "./query";

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
    // Read tags from frontmatter — TFile has no .tags property at runtime.
    // Obsidian stores frontmatter tags as string[] or a single string.
    const rawTags = frontmatter["tags"];
    const fileTags: string[] = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t))
      : typeof rawTags === "string" && rawTags
        ? [rawTags]
        : [];

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
      const specDiff = targetSpecificity(b.target) - targetSpecificity(a.target);
      if (specDiff !== 0) return specDiff;
      // Deeper inheritance chain = more specific schema = wins
      return b.inheritanceChain.length - a.inheritanceChain.length;
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

    if (target.query) {
      return evaluateQuery(target.query, file.path, fileTags, frontmatter);
    }

    if (target.property) {
      return Object.entries(target.property).every(([k, v]) => {
        const fmVal = frontmatter[k];
        const strVal =
          fmVal === null || fmVal === undefined ? "" : String(fmVal as string | number | boolean);
        return strVal === v;
      });
    }

    return false;
  }
}

function targetSpecificity(target: ResolvedSchema["target"]): number {
  return (target.query ? 2 : 0) + (target.property ? 1 : 0);
}
