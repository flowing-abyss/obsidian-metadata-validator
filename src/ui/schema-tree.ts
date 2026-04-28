import type { App } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { ManifestCache } from "../manifest/cache";
import type { Manifest } from "../types";

export class SchemaTreeView {
  private readonly app: App;
  private readonly cache: ManifestCache;
  // resolver stored for future use (e.g. showing resolved schema details)
  private readonly resolver: SchemaResolver;
  private readonly openSchemaEditor: ((path: string) => void) | null;

  constructor(
    app: App,
    cache: ManifestCache,
    resolver: SchemaResolver,
    openSchemaEditor?: (path: string) => void
  ) {
    this.app = app;
    this.cache = cache;
    this.resolver = resolver;
    this.openSchemaEditor = openSchemaEditor ?? null;
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
      // Start expanded so the user sees the hierarchy immediately
      const toggle = row.createSpan({ text: "▾", cls: "mv-tree-toggle" });
      const childUl = li.createEl("ul", { cls: "mv-tree-children" });

      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const willCollapse = !childUl.hasClass("is-collapsed");
        childUl.toggleClass("is-collapsed", willCollapse);
        toggle.setText(willCollapse ? "▸" : "▾");
      });

      for (const child of children) {
        this.renderNode(child.path, childrenOf, childUl);
      }
    } else {
      row.createSpan({ text: "·", cls: "mv-tree-leaf" });
    }

    const displayName =
      typeof manifest.data.name === "string"
        ? manifest.data.name
        : (manifest.folderPath.split("/").pop() ?? "unknown");

    row.createSpan({
      text: displayName,
      cls: "mv-tree-name",
    });

    const fieldCount = Object.keys(manifest.data.fields ?? {}).length;
    row.createSpan({ text: `${fieldCount} fields`, cls: "mv-tree-count" });

    const targetQuery = manifest.data.target?.query;
    if (typeof targetQuery === "string") {
      row.createSpan({
        text: targetQuery,
        cls: "mv-tree-query",
      });
    }

    row.addEventListener("click", () => {
      if (this.openSchemaEditor) {
        this.openSchemaEditor(manifestPath);
      } else {
        void this.app.workspace.openLinkText(manifestPath, "");
      }
    });
  }
}
