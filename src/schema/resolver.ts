import type { TFile } from "obsidian";
import type { ManifestCache } from "../manifest/cache";
import type { Manifest, ManifestData, ManifestRule, ResolvedSchema } from "../types";
import { mergeRules, mergeSchemas } from "./merger";
import { evaluateQuery } from "./query";

interface ResolvedNode {
  schema: ResolvedSchema;
  mergedData: ManifestData;
}

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
      const node = this.resolve(manifest, new Set());
      if (node) this.resolved.set(manifest.path, node.schema);
    }
  }

  private resolve(manifest: Manifest, visiting: Set<string>): ResolvedNode | null {
    if (visiting.has(manifest.path)) {
      console.warn(`[MetadataValidator] Circular inheritance detected at ${manifest.path}`);
      return null;
    }
    visiting.add(manifest.path);

    try {
      const parent = this.findParent(manifest);
      if (!parent) {
        return {
          schema: this.toResolved(manifest, manifest.data, [manifest.path]),
          mergedData: manifest.data,
        };
      }

      const parentNode = this.resolve(parent, visiting);
      if (!parentNode) return null;

      const mergedData = mergeSchemas(parentNode.mergedData, manifest.data);
      const chain = [...parentNode.schema.inheritanceChain, manifest.path];
      return {
        schema: this.toResolved(manifest, mergedData, chain),
        mergedData,
      };
    } finally {
      visiting.delete(manifest.path);
    }
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
      description: manifest.data.description,
      manifestSummaries: chain.map((path) => {
        const ancestor = this.cache.getByFolder(path.replace(/\/manifest\.md$/, ""));
        return {
          path,
          name: ancestor?.data.name ?? path.split("/").slice(-2)[0] ?? path,
          description: ancestor?.data.description,
        };
      }),
      priority: data.priority ?? 0,
      enforce_folder: data.enforce_folder,
      target: data.target ?? {},
      fields: data.fields ?? {},
      rules: this.collectRules(manifest, chain),
      parseErrors: this.collectParseErrors(manifest, chain),
      formatting: data.formatting ?? {},
      inheritanceChain: chain,
    };
  }

  /** "path: message" for every manifest.md or rules.md in the chain whose YAML failed to parse. */
  private collectParseErrors(manifest: Manifest, chain: string[]): string[] {
    const errors: string[] = [];
    for (const rf of this.cache.getRulesFilesForFolder(manifest.folderPath)) {
      if (rf.parseError) errors.push(`${rf.path}: ${rf.parseError}`);
    }
    for (const path of chain) {
      const m = this.cache.getByPath(path);
      if (m?.data.parseError) errors.push(`${m.path}: ${m.data.parseError}`);
    }
    return errors;
  }

  /**
   * Rules in execution order: every applicable rules.md (outermost folder first),
   * then the manifest chain from the root ancestor to this manifest. Same-name
   * rules replace earlier ones in place, a manifest's `exclude` drops rules by name.
   */
  private collectRules(manifest: Manifest, chain: string[]): ManifestRule[] {
    let rules: ManifestRule[] = [];
    for (const rf of this.cache.getRulesFilesForFolder(manifest.folderPath)) {
      rules = mergeRules(rules, rf.rules);
    }
    for (const path of chain) {
      const m = this.cache.getByPath(path);
      if (!m) continue;
      rules = mergeRules(rules, m.data.rules, m.data.exclude);
    }
    return rules;
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
        const strVal = fmVal === null || fmVal === undefined ? "" : String(fmVal); // eslint-disable-line @typescript-eslint/no-base-to-string -- frontmatter values are primitives or stringifiable
        return strVal === v;
      });
    }

    return false;
  }
}

function targetSpecificity(target: ResolvedSchema["target"]): number {
  return (target.query ? 2 : 0) + (target.property ? 1 : 0);
}
