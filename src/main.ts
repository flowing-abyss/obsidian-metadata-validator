import { Menu, Notice, Plugin, TFile, WorkspaceLeaf, stringifyYaml } from "obsidian";
import { ManifestCache } from "./manifest/cache";
import { SchemaResolver } from "./schema/resolver";
import { DEFAULT_SETTINGS, MetadataValidatorSettingTab, type PluginSettings } from "./settings";
import type { ValidationResult } from "./types";
import type { BasesDecorator as BasesDecoratorType } from "./ui/bases-decorator";
import type { BasesValidator as BasesValidatorType } from "./ui/bases-validator";
import { ContextMenuModal } from "./ui/context-menu-modal";
import { CssInjector } from "./ui/css-injector";
import { PropertyDecorator } from "./ui/decorator";
import { ExplorerBadges } from "./ui/explorer-badges";
import type { SchemaEditorModal as SchemaEditorModalType } from "./ui/schema-editor-modal";
import {
  SIDEBAR_PANEL_TYPE,
  SidebarPanel,
  type VaultIssueNote,
  type VaultScanProgress,
  type VaultScanReport,
} from "./ui/sidebar-panel";
import { applyVaultAutoFixes } from "./validation/batch-auto-fix";
import { ValidationEngine } from "./validation/engine";
import { sanitizeFrontmatter } from "./validation/frontmatter";
import { checkFolderLocation } from "./validation/rules/folder-location";

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
  /** True when the right-click came from an internal-link inside an embedded Bases view */
  private _contextMenuFromBases = false;
  private basesValidator: BasesValidatorType | null = null;

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
          async (onProgress) => {
            const report = await this.scanVaultForSidebar(onProgress);
            this.getSidebarPanel()?.showVaultScan(report);
          },
          async () => {
            await this.applyAutoFixesAcrossVault();
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
          this.basesValidator?.invalidate(file.path);
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
          // editor-menu fires alongside file-menu in editor context — skip to avoid duplicates.
          // In non-editor views (Bases, file explorer), editor-menu never fires, so we must not skip.
          // Exception: links inside embedded Bases views (![[*.base]]) set _contextMenuFromBases — we
          // must handle them here because editor-menu either doesn't fire or targets the wrong file.
          if (source === "editor") return;
          const fromBases = this._contextMenuFromBases;
          this._contextMenuFromBases = false;
          if (
            source === "link-context-menu" &&
            this.app.workspace.activeEditor != null &&
            !fromBases
          )
            return;

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
          this._contextMenuFromBases = false;
          const el = e.target as HTMLElement | null;

          // Internal links rendered inside embedded Bases views (![[*.base]])
          const basesLinkEl = el?.closest<HTMLElement>(
            ".internal-link[data-link-path], .internal-link[data-href]"
          );
          if (basesLinkEl?.closest(".bases-view")) {
            const href =
              basesLinkEl.getAttribute("data-link-path") ?? basesLinkEl.getAttribute("data-href");
            if (href) {
              const basesFile = this.app.vault.getAbstractFileByPath(href);
              if (basesFile instanceof TFile) {
                this._contextMenuLinkTarget = basesFile;
                this._contextMenuFromBases = true;
              }
            }
            return;
          }

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
                if (!schema) {
                  new Notice("No schema matches this note.");
                  return;
                }
                const getFields = (p: string) => this.cache.getByPath(p)?.data.fields;
                new ContextMenuModal(
                  this.app,
                  targetFile,
                  schema,
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

      // Bases validator (lazy import)
      void import("./ui/bases-validator").then(
        (mod: { BasesValidator: typeof BasesValidatorType }) => {
          this.basesValidator = new mod.BasesValidator(
            this.app,
            this.resolver,
            this.engine,
            this.settings
          );
          if (this.settings.showBasesErrors) this.basesValidator.attach();
          this.register(() => this.basesValidator?.detach());
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

  toggleBasesValidator(enabled: boolean): void {
    if (enabled) {
      this.basesValidator?.attach();
    } else {
      this.basesValidator?.detach();
    }
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
    const frontmatter = sanitizeFrontmatter(
      this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined
    );
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

    // Snapshot before engine mutates frontmatter in place (via applyAutoFix / applyPropertyOrder)
    const preEngineFrontmatter: Record<string, unknown> = { ...frontmatter };

    const results = await this.engine.validate(file, frontmatter, schema);

    this.appendLegacyEnforceFolderWarning(results, schema.enforce_folder, schema.manifestPath);

    const hasAutoFix = results.some((r) => r.autoFixed);
    if (hasAutoFix) {
      // Compute which keys the engine actually changed (value-level diff).
      // This is critical: we must NOT write the full stale `frontmatter` snapshot because a
      // concurrent picker save (via processFrontMatter) may have already updated the file
      // between when we read the cache and now. Writing the whole snapshot would overwrite the
      // user's new value with the old one (TOCTOU race condition).
      const engineValueChanges: Record<string, unknown> = {};
      for (const k of Object.keys(frontmatter)) {
        if (!(k in preEngineFrontmatter) || preEngineFrontmatter[k] !== frontmatter[k]) {
          engineValueChanges[k] = frontmatter[k];
        }
      }
      const hasValueChanges = Object.keys(engineValueChanges).length > 0;
      const hasOrderChange = results.some((r) => r.rule === "property-order");

      if (hasValueChanges) {
        // Apply only the engine-computed value changes onto the LATEST frontmatter.
        // processFrontMatter reads the current file state inside its callback, so it is
        // atomic with respect to other processFrontMatter calls and never races with the picker.
        const effectiveOrder = schema.formatting.property_order?.length
          ? schema.formatting.property_order
          : Object.keys(schema.fields);
        await this.app.fileManager.processFrontMatter(file, (latestFm) => {
          const latestFrontmatter = latestFm as Record<string, unknown>;
          for (const [k, v] of Object.entries(engineValueChanges)) {
            latestFrontmatter[k] = v;
          }
          // Re-apply property ordering to the latest frontmatter in the same atomic write
          if (hasOrderChange && effectiveOrder.length) {
            const keys = Object.keys(latestFrontmatter);
            const orderedKeys = [
              ...effectiveOrder.filter((ok) => keys.includes(ok)),
              ...keys.filter((k) => !effectiveOrder.includes(k)),
            ];
            if (!orderedKeys.every((k, i) => k === keys[i])) {
              const copy: Record<string, unknown> = { ...latestFrontmatter };
              for (const k of keys) Reflect.deleteProperty(latestFrontmatter, k);
              for (const k of orderedKeys) latestFrontmatter[k] = copy[k];
            }
          }
        });
      } else if (hasOrderChange) {
        // Ordering-only change: use processFrontMatter so we read the latest file state.
        // Writing the stale `frontmatter` snapshot here would overwrite a concurrent picker save.
        const effectiveOrder2 = schema.formatting.property_order?.length
          ? schema.formatting.property_order
          : Object.keys(schema.fields);
        if (effectiveOrder2.length) {
          await this.app.fileManager.processFrontMatter(file, (latestFm) => {
            const latestFrontmatter = latestFm as Record<string, unknown>;
            const keys = Object.keys(latestFrontmatter);
            const orderedKeys = [
              ...effectiveOrder2.filter((ok) => keys.includes(ok)),
              ...keys.filter((k) => !effectiveOrder2.includes(k)),
            ];
            if (!orderedKeys.every((k, i) => k === keys[i])) {
              const copy: Record<string, unknown> = { ...latestFrontmatter };
              for (const k of keys) Reflect.deleteProperty(latestFrontmatter, k);
              for (const k of orderedKeys) latestFrontmatter[k] = copy[k];
            }
          });
        }
      }
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

  private appendLegacyEnforceFolderWarning(
    results: ValidationResult[],
    enforceFolder: boolean | string | undefined,
    manifestPath: string
  ): void {
    if (enforceFolder !== true) return;

    results.push({
      field: "__location__",
      severity: "warning",
      message:
        "enforce_folder: true has no effect on its own. Set enforce_folder to a folder path string.",
      rule: "enforce_folder",
      manifestPath,
      autoFixed: false,
    });
  }

  private async validateForVaultScan(file: TFile): Promise<{
    manifestPath: string;
    manifestName: string;
    errors: number;
    warnings: number;
    issues: ValidationResult[];
  } | null> {
    const frontmatter = sanitizeFrontmatter(
      this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined
    );
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return null;

    const results = await this.engine.validate(file, frontmatter, schema);
    this.appendLegacyEnforceFolderWarning(results, schema.enforce_folder, schema.manifestPath);

    const issues = results.filter((r) => !r.autoFixed);

    return {
      manifestPath: schema.manifestPath,
      manifestName: schema.name,
      errors: issues.filter((r) => r.severity === "error").length,
      warnings: issues.filter((r) => r.severity === "warning").length,
      issues,
    };
  }

  private async scanVaultForSidebar(
    onProgress?: (progress: VaultScanProgress) => void
  ): Promise<VaultScanReport> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !file.path.startsWith(this.settings.schemasRoot + "/"));

    onProgress?.({ processed: 0, total: files.length });
    await this.yieldScanProgressUi();

    let errorFiles = 0;
    let warningFiles = 0;
    let noSchemaFiles = 0;
    const reports: VaultIssueNote[] = [];

    let processed = 0;
    for (const file of files) {
      const scan = await this.validateForVaultScan(file);
      if (!scan) {
        noSchemaFiles++;
        processed++;
        onProgress?.({ processed, total: files.length });
        if (processed % 20 === 0 || processed === files.length) {
          await this.yieldScanProgressUi();
        }
        continue;
      }

      if (scan.errors > 0) errorFiles++;
      else if (scan.warnings > 0) warningFiles++;

      if (scan.issues.length > 0) {
        reports.push({
          filePath: file.path,
          fileName: file.basename,
          manifestPath: scan.manifestPath,
          manifestName: scan.manifestName,
          results: scan.issues,
        });
      }

      processed++;
      onProgress?.({ processed, total: files.length });
      if (processed % 20 === 0 || processed === files.length) {
        await this.yieldScanProgressUi();
      }
    }

    return {
      stats: {
        total: files.length,
        errors: errorFiles,
        warnings: warningFiles,
        noSchema: noSchemaFiles,
      },
      reports,
      scannedAt: Date.now(),
    };
  }

  private async yieldScanProgressUi(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  private async applyAutoFixesAcrossVault(): Promise<void> {
    await this.reloadSchemas();

    const summary = await applyVaultAutoFixes({
      app: this.app,
      schemasRoot: this.settings.schemasRoot,
      resolver: this.resolver,
      engine: this.engine,
      writeFrontmatter: (file, frontmatter) => this.writeOrderedFrontmatter(file, frontmatter),
      onFileProcessed: ({ previousPath, filePath, status }) => {
        if (previousPath !== filePath) this.badges.setStatus(previousPath, "none");
        this.badges.setStatus(filePath, status);
      },
    });

    if (this.settings.showFileExplorerBadges) this.badges.render();
    this.decorator.invalidateAll();
    this.decorator.clearIcons();
    this.decorator.decorateNow();

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) await this.validateAndUpdate(activeFile);

    new Notice(
      [
        `Auto-fix complete: ${summary.changed} note(s) changed`,
        `${summary.autoFixed} fix(es) applied`,
        `${summary.moved} moved`,
        `${summary.errors} error(s) remain`,
        `${summary.warnings} warning(s) remain`,
        summary.failed > 0 ? `${summary.failed} failed` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
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
