import { Menu, Notice, Plugin, TFile, WorkspaceLeaf, stringifyYaml } from "obsidian";
import { DEFAULT_SETTINGS, MetadataValidatorSettingTab, type PluginSettings } from "./settings";
import type { ValidationResult } from "./types";
import { ManifestCache } from "./manifest/cache";
import { SchemaResolver } from "./schema/resolver";
import { ValidationEngine } from "./validation/engine";
import { CssInjector } from "./ui/css-injector";
import { PropertyDecorator } from "./ui/decorator";
import { ContextMenuModal } from "./ui/context-menu-modal";
import { SidebarPanel, SIDEBAR_PANEL_TYPE } from "./ui/sidebar-panel";
import { ExplorerBadges } from "./ui/explorer-badges";
import { checkFolderLocation } from "./validation/rules/folder-location";
import type { BasesDecorator as BasesDecoratorType } from "./ui/bases-decorator";
import type { ValidationReportModal as ValidationReportModalType } from "./ui/validation-report";
import type { SchemaEditorModal as SchemaEditorModalType } from "./ui/schema-editor-modal";

export default class MetadataValidatorPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  cache!: ManifestCache;
  resolver!: SchemaResolver;
  private engine!: ValidationEngine;
  cssInjector!: CssInjector;
  decorator!: PropertyDecorator;
  badges!: ExplorerBadges;
  private settingTab!: MetadataValidatorSettingTab;
  /** File resolved from a wikilink right-click — consumed once by editor-menu */
  private _contextMenuLinkTarget: TFile | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize all layers — but don't load vault files yet (vault not ready)
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    this.resolver = new SchemaResolver(this.cache);
    this.engine = new ValidationEngine(this.app);
    this.cssInjector = new CssInjector(this.settings);
    this.decorator = new PropertyDecorator(this.app, this.resolver, this.engine, this.settings);
    this.badges = new ExplorerBadges();

    // Apply CSS overrides immediately (no vault needed)
    this.cssInjector.update();

    // Register sidebar view type — pass callbacks so the panel validates immediately on open
    // and supports scanning the entire vault
    this.registerView(
      SIDEBAR_PANEL_TYPE,
      (leaf) =>
        new SidebarPanel(
          leaf,
          () => {
            const file = this.app.workspace.getActiveFile();
            if (file) void this.validateAndUpdate(file);
          },
          async () => {
            const files = this.app.vault
              .getMarkdownFiles()
              .filter((f) => !f.path.startsWith(this.settings.schemasRoot + "/"));
            let errorFiles = 0;
            let warningFiles = 0;
            let noSchemaFiles = 0;
            for (const f of files) {
              const stats = await this.validateForStats(f);
              if (stats === null) noSchemaFiles++;
              else if (stats.errors > 0) errorFiles++;
              else if (stats.warnings > 0) warningFiles++;
            }
            const panel = this.getSidebarPanel();
            panel?.showVaultStats({
              total: files.length,
              errors: errorFiles,
              warnings: warningFiles,
              noSchema: noSchemaFiles,
            });
          }
        )
    );

    // Register settings tab
    this.settingTab = new MetadataValidatorSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Register commands
    this.addCommand({
      id: "validate-current-note",
      name: "Validate current note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) await this.validateAndUpdate(file);
      },
    });

    this.addCommand({
      id: "open-sidebar-panel",
      name: "Open validation panel",
      callback: () => void this.activateSidebarPanel(),
    });

    this.addCommand({
      id: "show-vault-report",
      name: "Show vault validation report",
      callback: () => {
        void import("./ui/validation-report").then(
          (mod: { ValidationReportModal: typeof ValidationReportModalType }) => {
            new mod.ValidationReportModal(this.app, this.resolver, this.engine).open();
          }
        );
      },
    });

    this.addCommand({
      id: "edit-schema-for-note",
      name: "Edit schema for current note",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
          string,
          unknown
        >;
        const schema = this.resolver.resolveForNote(file, fm);
        if (!schema) {
          new Notice("No schema matches this note.");
          return;
        }
        void this.openSchemaEditor(schema.manifestPath);
      },
    });

    this.addCommand({
      id: "create-schema",
      name: "Create new schema",
      callback: () => void this.openSchemaEditor(null),
    });

    this.addCommand({
      id: "edit-properties",
      name: "Edit properties",
      callback: () => this.openPropertiesForActiveFile(),
    });

    // === CRITICAL: wait for vault to be fully indexed before loading schemas ===
    this.app.workspace.onLayoutReady(async () => {
      // Load schemas from vault
      await this.cache.load();
      this.resolver.rebuild();

      // Start DOM decoration
      this.decorator.attach();

      // Register vault event watchers
      this.registerEvent(
        this.app.vault.on("modify", async (file: TFile) => {
          if (file.basename === "manifest" && file.extension === "md") {
            await this.cache.refresh(file);
            this.resolver.rebuild();
            this.settingTab.refreshTree();
            // Schema changed — discard stale icons and cached results so the
            // active note is re-decorated with the new field definitions.
            const active = this.app.workspace.getActiveFile();
            if (active) this.decorator.invalidate(active.path);
            this.decorator.clearIcons();
            this.decorator.decorateNow();
            if (active) await this.validateAndUpdate(active);
          }
        })
      );

      this.registerEvent(
        this.app.metadataCache.on("changed", async (file: TFile) => {
          if (file.path.startsWith(this.settings.schemasRoot + "/")) return;
          // Invalidate the decorator's result cache so stale icons don't linger
          this.decorator.invalidate(file.path);
          if (this.settings.enableOnSave) {
            await this.validateAndUpdate(file);
          }
          // Re-decorate so validator icons reflect the updated value immediately.
          // MutationObserver alone is not reliable here: Obsidian sometimes updates
          // property values in-place (no childList mutation) rather than removing and
          // re-adding the .metadata-property element.
          this.decorator.decorateNow();
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", (file: TFile) => {
          if (file.basename === "manifest" && file.extension === "md") {
            this.cache.delete(file.path);
            this.resolver.rebuild();
          }
        })
      );

      this.registerEvent(
        this.app.workspace.on("file-open", async (file: TFile | null) => {
          if (!file) return;
          // Decorate immediately — no debounce — so icons appear on first paint
          this.decorator.decorateNow();
          if (this.settings.enableOnOpen) {
            await this.validateAndUpdate(file);
          }
        })
      );

      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          // Also trigger when switching panes/tabs without a full file-open
          this.decorator.decorateNow();
        })
      );

      // Context menu
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu, file: TFile, source: string) => {
          // editor-menu already adds "Edit properties" for editor right-clicks — skip to avoid duplicates
          if (source === "link-context-menu" || source === "editor") return;

          // On manifest.md files — offer schema editor
          if (file.basename === "manifest" && file.extension === "md") {
            menu.addItem((item) =>
              item
                .setTitle("Edit schema")
                .setIcon("settings-2")
                .onClick(() => void this.openSchemaEditor(file.path))
            );
            return;
          }

          if (file.extension !== "md") return;

          menu.addItem((item) =>
            item
              .setTitle("Edit properties")
              .setIcon("pencil")
              .onClick(() => {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
                  | Record<string, unknown>
                  | undefined;
                const schema = this.resolver.resolveForNote(file, fm ?? {});
                if (!schema) {
                  new Notice("No schema matches this note.");
                  return;
                }
                const getFields = (p: string) => this.cache.getByPath(p)?.data.fields;
                new ContextMenuModal(
                  this.app,
                  file,
                  schema,
                  getFields,
                  (p) => void this.openSchemaEditor(p)
                ).open();
              })
          );

          // "Edit schema" only when there's a schema to edit
          const fmForSchema = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
          const schemaForMenu = this.resolver.resolveForNote(file, fmForSchema ?? {});
          if (schemaForMenu) {
            menu.addItem((item) =>
              item
                .setTitle("Edit schema")
                .setIcon("settings-2")
                .onClick(() => void this.openSchemaEditor(schemaForMenu.manifestPath))
            );
          }
        })
      );

      // Capture right-clicked wikilink target *before* editor-menu fires
      this.registerDomEvent(
        document,
        "contextmenu",
        (e: MouseEvent) => {
          this._contextMenuLinkTarget = null;
          const el = e.target as HTMLElement | null;
          // CodeMirror wraps wikilink parts in .cm-hmd-internal-link spans
          const linkSpan = el?.closest<HTMLElement>(".cm-hmd-internal-link");
          if (!linkSpan) return;

          const activeFile = this.app.workspace.getActiveFile();
          if (!activeFile) return;

          // Collect all sibling spans of the same link group to build the full link text
          const parent = linkSpan.parentElement;
          if (!parent) return;
          const spans = Array.from(parent.querySelectorAll<HTMLElement>(".cm-hmd-internal-link"));
          const linkText = (
            spans
              .map((s) => s.textContent ?? "")
              .join("")
              .split("|")[0] ?? ""
          ).trim();
          if (!linkText) return;

          const resolved = this.app.metadataCache.getFirstLinkpathDest(linkText, activeFile.path);
          if (resolved instanceof TFile) this._contextMenuLinkTarget = resolved;
        },
        { capture: true }
      );

      // Editor right-click context menu
      this.registerEvent(
        this.app.workspace.on("editor-menu", (menu) => {
          const activeFile = this.app.workspace.getActiveFile();
          if (!activeFile) return;

          // Use the link target captured by the contextmenu DOM event (if any)
          const targetFile = this._contextMenuLinkTarget ?? activeFile;
          this._contextMenuLinkTarget = null;

          const fm = this.app.metadataCache.getFileCache(targetFile)?.frontmatter as
            | Record<string, unknown>
            | undefined;
          const schema = this.resolver.resolveForNote(targetFile, fm ?? {});

          const title = "Edit properties";

          menu.addItem((item) =>
            item
              .setTitle(title)
              .setIcon("pencil")
              .onClick(() => {
                const getFields = (p: string) => this.cache.getByPath(p)?.data.fields;
                new ContextMenuModal(
                  this.app,
                  targetFile,
                  schema ?? {
                    fields: {},
                    manifestPath: "",
                    name: "",
                    priority: 0,
                    target: {},
                    formatting: {},
                    inheritanceChain: [],
                  },
                  getFields,
                  (p) => void this.openSchemaEditor(p)
                ).open();
              })
          );
        })
      );

      // Right-click on wikilinks in properties panel → "Edit properties"
      this.registerDomEvent(document, "contextmenu", (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Only act on internal-link elements inside a metadata-property value
        const linkEl = target.closest<HTMLElement>(
          ".metadata-property .internal-link, .metadata-property [data-type='wikilink']"
        );
        if (!linkEl) return;

        const propRow = linkEl.closest<HTMLElement>(".metadata-property");
        if (!propRow) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter as
          | Record<string, unknown>
          | undefined;
        const schema = this.resolver.resolveForNote(activeFile, fm ?? {});
        if (!schema) return;

        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle("Edit properties")
            .setIcon("pencil")
            .onClick(() => {
              const getFields = (p: string) => this.cache.getByPath(p)?.data.fields;
              new ContextMenuModal(
                this.app,
                activeFile,
                schema,
                getFields,
                (p) => void this.openSchemaEditor(p)
              ).open();
            })
        );
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
      });

      // Bases decorator (lazy import)
      void import("./ui/bases-decorator").then(
        (mod: { BasesDecorator: typeof BasesDecoratorType }) => {
          const basesDecorator = new mod.BasesDecorator(this.app, this.resolver, this.settings);
          basesDecorator.attach();
          this.register(() => basesDecorator.detach());
        }
      );

      // Decorate and validate the currently active file right away.
      // file-open does not fire for notes that were already open when Obsidian
      // restarted, so we must do this explicitly after layout is ready.
      const activeFile = this.app.workspace.getActiveFile();
      this.decorator.decorateNow();
      if (activeFile && this.settings.enableOnOpen) {
        await this.validateAndUpdate(activeFile);
      }
    });
  }

  onunload(): void {
    this.decorator.detach();
    this.cssInjector.remove();
    this.badges.clearAll();
  }

  async reloadSchemas(): Promise<void> {
    // Create fresh cache with (potentially updated) schemasRoot
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    await this.cache.load();
    // Update the resolver's cache reference in-place (decorator still points to same resolver)
    this.resolver.setCache(this.cache);
    this.resolver.rebuild();
    this.settingTab?.refreshTree();
  }

  private async validateAndUpdate(file: TFile): Promise<void> {
    const metaCache = this.app.metadataCache.getFileCache(file);
    // Obsidian injects a non-YAML 'position' key into the frontmatter cache object.
    // Strip it before processing so it doesn't get written back to the file.
    const rawFm = (metaCache?.frontmatter ?? {}) as Record<string, unknown>;
    const frontmatter: Record<string, unknown> = { ...rawFm };
    delete frontmatter["position"];
    const schema = this.resolver.resolveForNote(file, frontmatter);

    if (!schema) {
      this.badges.setStatus(file.path, "none");
      this.updateSidebarPanel(file.basename, []);
      return;
    }

    // enforce_folder: only a string path is actionable now (true alone has no effect)
    const enforcePath =
      typeof schema.enforce_folder === "string" ? schema.enforce_folder : undefined;

    // enforce_folder: auto-move if needed
    if (enforcePath) {
      const moveResult = checkFolderLocation(file.path, enforcePath, schema.manifestPath);
      if (moveResult) {
        await this.app.fileManager.renameFile(file, moveResult.targetPath);
        new Notice(`Moved "${file.basename}" → ${moveResult.targetPath}`);
        return;
      }
    }

    const results = await this.engine.validate(file, frontmatter, schema);

    // Warn when enforce_folder: true (without a path — no-op)
    if (schema.enforce_folder === true) {
      results.push({
        field: "__location__",
        severity: "warning",
        message:
          "enforce_folder: true has no effect on its own. Set enforce_folder to a folder path string.",
        rule: "enforce_folder",
        manifestPath: schema.manifestPath,
        autoFixed: false,
      });
    }

    const hasAutoFix = results.some((r) => r.autoFixed);
    if (hasAutoFix) {
      // Write directly to preserve key insertion order — processFrontMatter may reorder keys
      await this.writeOrderedFrontmatter(file, frontmatter);
    }

    const errors = results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = results.filter((r) => !r.autoFixed && r.severity === "warning");
    this.badges.setStatus(
      file.path,
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid"
    );
    if (this.settings.showFileExplorerBadges) this.badges.render();

    this.updateSidebarPanel(file.basename, results);
  }

  /** Look up the live SidebarPanel instance from the workspace — never stale. */
  private updateSidebarPanel(fileName: string, results: ValidationResult[]): void {
    this.getSidebarPanel()?.update(fileName, results);
  }

  /**
   * Write frontmatter to a file preserving exact key insertion order.
   * Uses vault.read + vault.modify to bypass processFrontMatter's potential key reordering.
   */
  private async writeOrderedFrontmatter(
    file: TFile,
    frontmatter: Record<string, unknown>
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    // stringifyYaml always ends with \n
    const newYaml = stringifyYaml(frontmatter);
    if (!fmMatch) {
      // New file with no frontmatter block — prepend one
      await this.app.vault.modify(file, `---\n${newYaml}---\n${content}`);
      return;
    }
    const afterFrontmatter = content.slice(fmMatch[0].length);
    await this.app.vault.modify(file, `---\n${newYaml}---\n${afterFrontmatter}`);
  }

  /**
   * Validate a file and return raw error/warning counts without touching the UI.
   * Returns null if no schema matches.
   */
  private async validateForStats(
    file: TFile
  ): Promise<{ errors: number; warnings: number } | null> {
    const rawFm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
      string,
      unknown
    >;
    const frontmatter: Record<string, unknown> = { ...rawFm };
    delete frontmatter["position"];
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return null;
    const results = await this.engine.validate(file, frontmatter, schema);
    return {
      errors: results.filter((r) => !r.autoFixed && r.severity === "error").length,
      warnings: results.filter((r) => !r.autoFixed && r.severity === "warning").length,
    };
  }

  /** Return the live SidebarPanel instance, or undefined if none is open. */
  private getSidebarPanel(): SidebarPanel | undefined {
    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_PANEL_TYPE);
    return leaves[0]?.view as SidebarPanel | undefined;
  }

  private async activateSidebarPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIDEBAR_PANEL_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0] as WorkspaceLeaf);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: SIDEBAR_PANEL_TYPE });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open the schema editor for a manifest.md. Pass null to create a new schema. */
  private openPropertiesForActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    const schema = this.resolver.resolveForNote(file, fm ?? {});
    if (!schema) {
      new Notice("No schema matches this note.");
      return;
    }
    const getFields = (p: string) => this.cache.getByPath(p)?.data.fields;
    new ContextMenuModal(
      this.app,
      file,
      schema,
      getFields,
      (p) => void this.openSchemaEditor(p)
    ).open();
  }

  async openSchemaEditor(manifestPath: string | null): Promise<void> {
    const { SchemaEditorModal } = (await import("./ui/schema-editor-modal")) as {
      SchemaEditorModal: typeof SchemaEditorModalType;
    };

    let path = manifestPath;
    let data = {};

    if (path) {
      const manifest = this.cache.getAll().find((m) => m.path === path);
      data = manifest?.data ?? {};
    } else {
      // Prompt for folder path then create
      path = `${this.settings.schemasRoot}/new-schema/manifest.md`;
    }

    new SchemaEditorModal(
      this.app,
      path,
      data,
      async () => {
        await this.reloadSchemas();
      },
      this.cache,
      (p) => void this.openSchemaEditor(p)
    ).open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PluginSettings>
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
