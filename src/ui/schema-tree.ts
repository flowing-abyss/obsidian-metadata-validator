import type { App } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ManifestCache } from "../manifest/cache";
import type { Manifest } from "../types";

export class SchemaTreeView {
  private readonly app: App;
  private readonly cache: ManifestCache;
  // resolver stored for future use (e.g. showing resolved schema details)
  private readonly resolver: SchemaResolver;

  constructor(app: App, cache: ManifestCache, resolver: SchemaResolver) {
    this.app = app;
    this.cache = cache;
    this.resolver = resolver;
  }

  render(container: HTMLElement): void {
    container.empty();

    const manifests = this.cache.getAll();
    if (manifests.length === 0) {
      container.createEl("p", { text: "No manifest files found in the schemas folder." });
      return;
    }

    const childrenOf = new Map<string | null, Manifest[]>();
    for (const m of manifests) {
      const parts = m.folderPath.split("/");
      const parentFolder = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
      const parentManifest = parentFolder ? this.cache.getByFolder(parentFolder) : null;
      const parentKey = m.data.extends
        ? (this.cache.getByFolder(m.data.extends)?.path ?? null)
        : (parentManifest?.path ?? null);

      const existing = childrenOf.get(parentKey) ?? [];
      existing.push(m);
      childrenOf.set(parentKey, existing);
    }

    const roots = childrenOf.get(null) ?? [];
    const ul = container.createEl("ul");

    for (const root of roots) {
      this.renderNode(root.path, childrenOf, ul);
    }
  }

  private renderNode(
    manifestPath: string,
    childrenOf: Map<string | null, Manifest[]>,
    parentEl: HTMLElement
  ): void {
    const manifest = this.cache.getByPath(manifestPath);
    if (!manifest) return;

    const li = parentEl.createEl("li");
    const row = li.createDiv("mv-tree-row");

    const children = childrenOf.get(manifestPath) ?? [];
    if (children.length > 0) {
      const toggle = row.createEl("span", { text: "▸", cls: "mv-tree-toggle" });
      const childUl = li.createEl("ul", { cls: "mv-tree-children is-collapsed" });

      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = !childUl.hasClass("is-collapsed");
        childUl.toggleClass("is-collapsed", !isOpen);
        toggle.toggleClass("is-open", isOpen);
      });

      for (const child of children) {
        this.renderNode(child.path, childrenOf, childUl);
      }
    } else {
      row.createEl("span", { text: "·", cls: "mv-tree-leaf" });
    }

    const displayName =
      typeof manifest.data.name === "string"
        ? manifest.data.name
        : (manifest.folderPath.split("/").pop() ?? "unknown");

    row.createEl("span", {
      text: displayName,
      cls: "mv-tree-name",
    });

    const fieldCount = Object.keys(manifest.data.fields ?? {}).length;
    row.createEl("span", { text: `${fieldCount} fields`, cls: "mv-tree-count" });

    const targetFolder = manifest.data.target?.folder;
    if (typeof targetFolder === "string") {
      row.createEl("span", {
        text: `📁 ${targetFolder}`,
        cls: "mv-tree-folder",
      });
    }
    const targetTag = manifest.data.target?.tag;
    if (typeof targetTag === "string") {
      row.createEl("span", {
        text: targetTag,
        cls: "mv-tree-tag",
      });
    }

    row.addEventListener("click", () => {
      void this.app.workspace.openLinkText(manifestPath, "");
    });
  }
}
