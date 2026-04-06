import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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
  private decorator!: PropertyDecorator;
  private badges!: ExplorerBadges;
  private backgroundScanTimer: number | null = null;

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

    // Register sidebar view type — pass callback so the panel validates immediately on open
    this.registerView(
      SIDEBAR_PANEL_TYPE,
      (leaf) =>
        new SidebarPanel(leaf, () => {
          const file = this.app.workspace.getActiveFile();
          if (file) void this.validateAndUpdate(file);
        })
    );

    // Register settings tab
    this.addSettingTab(new MetadataValidatorSettingTab(this.app, this));

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
          }
          if (this.settings.enableOnSave) {
            await this.validateAndUpdate(file);
          }
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
          if (this.settings.enableOnOpen) {
            await this.validateAndUpdate(file);
          }
        })
      );

      // Context menu
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu, file: TFile) => {
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

          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
          const schema = this.resolver.resolveForNote(file, fm ?? {});
          if (!schema) return;

          menu.addItem((item) =>
            item
              .setTitle("Edit properties")
              .setIcon("pencil")
              .onClick(() => new ContextMenuModal(this.app, file, schema).open())
          );

          menu.addItem((item) =>
            item
              .setTitle("Edit schema")
              .setIcon("settings-2")
              .onClick(() => void this.openSchemaEditor(schema.manifestPath))
          );
        })
      );

      // Bases decorator (lazy import)
      void import("./ui/bases-decorator").then(
        (mod: { BasesDecorator: typeof BasesDecoratorType }) => {
          const basesDecorator = new mod.BasesDecorator(this.app, this.resolver, this.settings);
          basesDecorator.attach();
          this.register(() => basesDecorator.detach());
        }
      );

      this.startBackgroundScan();

      // Validate the currently active file right away
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && this.settings.enableOnOpen) {
        await this.validateAndUpdate(activeFile);
      }
    });
  }

  onunload(): void {
    this.decorator.detach();
    this.cssInjector.remove();
    this.badges.clearAll();
    if (this.backgroundScanTimer) clearInterval(this.backgroundScanTimer);
  }

  async reloadSchemas(): Promise<void> {
    // Create fresh cache with (potentially updated) schemasRoot
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    await this.cache.load();
    // Update the resolver's cache reference in-place (decorator still points to same resolver)
    this.resolver.setCache(this.cache);
    this.resolver.rebuild();
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

    // enforce_folder: auto-move if needed
    if (schema.enforce_folder === true && schema.target.folder) {
      const moveResult = checkFolderLocation(file.path, schema.target.folder, schema.manifestPath);
      if (moveResult) {
        await this.app.fileManager.renameFile(file, moveResult.targetPath);
        new Notice(`Moved "${file.basename}" → ${moveResult.targetPath}`);
        return;
      }
    }

    const results = await this.engine.validate(file, frontmatter, schema);

    const hasAutoFix = results.some((r) => r.autoFixed);
    if (hasAutoFix) {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Delete only user-facing keys (skip Obsidian-internal 'position')
        for (const k of Object.keys(fm)) {
          if (k !== "position") delete fm[k];
        }
        Object.assign(fm, frontmatter);
      });
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
    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_PANEL_TYPE);
    if (leaves.length > 0) {
      (leaves[0]?.view as SidebarPanel | undefined)?.update(fileName, results);
    }
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

  private startBackgroundScan(): void {
    if (this.backgroundScanTimer) clearInterval(this.backgroundScanTimer);
    const intervalMs = this.settings.backgroundScanInterval * 60 * 1000;
    this.backgroundScanTimer = this.registerInterval(
      window.setInterval(() => {
        void (async () => {
          const files = this.app.vault.getMarkdownFiles();
          for (const file of files) {
            await this.validateAndUpdate(file);
          }
        })();
      }, intervalMs)
    );
  }

  /** Open the schema editor for a manifest.md. Pass null to create a new schema. */
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

    new SchemaEditorModal(this.app, path, data, async () => {
      await this.reloadSchemas();
    }).open();
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
