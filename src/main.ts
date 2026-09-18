import { Menu, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
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
import { registerKeyboardPropertiesCommand } from "./commands/keyboard-properties";
import { ProgressNotice } from "./ui/progress-notice";

import {
  SIDEBAR_PANEL_TYPE,
  SidebarPanel,
  type VaultIssueNote,
  type VaultScanProgress,
  type VaultScanReport,
} from "./ui/sidebar-panel";
import { applyVaultAutoFixes } from "./validation/batch-auto-fix";
import { ChangeScheduler } from "./validation/change-scheduler";
import { ValidationEngine } from "./validation/engine";
import { sanitizeFrontmatter } from "./validation/frontmatter";
import { appendLegacyEnforceFolderWarning, validateNote } from "./validation/validate-note";
import { WriteBudget } from "./validation/write-budget";
import { SelfWrites } from "./validation/self-writes";
import { bumpSourceRevision } from "./schema/source-resolver";

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
  /** Coalesces file-change bursts so each note is validated once after it settles */
  private changeScheduler!: ChangeScheduler;
  /** Same coalescing for notes queued because a neighbour changed type; not tied to "validate on save" */
  private backlinkScheduler!: ChangeScheduler;
  /** Manifest each note resolved to at its last validation — a change means the note changed type */
  private readonly lastManifestByPath = new Map<string, string>();
  /** Caps rule-triggered writes per note so conflicting rules cannot ping-pong forever */
  private readonly writeBudget = new WriteBudget();
  /** Notes we just wrote: their "changed" event is an echo, not a user edit */
  private readonly selfWrites = new SelfWrites();
  /** Frontmatter hash at the last validation, so a body-only edit is not validated again */
  private readonly lastValidatedHash = new Map<string, string>();
  /** While the vault auto-fix runs, per-file change events are ignored (it redraws at the end) */
  private batchRunning = false;
  private lastUiYield = 0;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize all layers — but don't load vault files yet (vault not ready)
    this.cache = new ManifestCache(this.app, this.settings.schemasRoot);
    this.resolver = new SchemaResolver(this.cache);
    this.engine = new ValidationEngine(this.app, this.settings);
    this.cssInjector = new CssInjector(this.settings);
    this.decorator = new PropertyDecorator(this.app, this.resolver, this.engine, this.settings);
    this.badges = new ExplorerBadges();
    this.changeScheduler = new ChangeScheduler(
      (file) => {
        // The setting may have been turned off, or the note deleted, while pending
        if (!this.settings.enableOnSave) return;
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
        // A body-only edit leaves the frontmatter as it was last validated: nothing to do
        if (this.lastValidatedHash.get(file.path) === this.frontmatterHash(file)) return;
        this.validateAndUpdate(file).catch((error: unknown) => {
          console.error(`[MetadataValidator] Failed to validate "${file.path}"`, error);
        });
      },
      () => this.settings.onSaveDelaySeconds * 1000
    );
    this.register(() => this.changeScheduler.dispose());
    this.backlinkScheduler = new ChangeScheduler(
      (file) => {
        if (!this.settings.revalidateBacklinks) return;
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
        this.validateAndUpdate(file).catch((error: unknown) => {
          console.error(`[MetadataValidator] Failed to revalidate "${file.path}"`, error);
        });
      },
      () => this.settings.onSaveDelaySeconds * 1000
    );
    this.register(() => this.backlinkScheduler.dispose());

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
      id: "auto-fix-vault",
      name: "Auto-fix all notes in vault",
      callback: () =>
        void this.applyAutoFixesAcrossVault().catch((error: unknown) => {
          console.error("[MetadataValidator] Vault auto-fix failed", error);
          new Notice("Auto-fix failed. Check the developer console for details.");
        }),
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
    registerKeyboardPropertiesCommand(this, this.resolver, () => this.settings.enableJsExecution);

    // === CRITICAL: wait for vault to be fully indexed before loading schemas ===
    this.app.workspace.onLayoutReady(async () => {
      // Load schemas from vault
      await this.cache.load();
      this.resolver.rebuild();

      // Start DOM decoration
      this.decorator.attach();

      // Register vault event watchers
      this.registerEvent(
        this.app.vault.on("modify", async (file: TAbstractFile) => {
          if (file instanceof TFile && this.isSchemaFile(file)) {
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
        this.app.metadataCache.on("changed", (file: TFile) => {
          if (file.path.startsWith(this.settings.schemasRoot + "/")) return;
          // The vault auto-fix redraws everything once at the end
          if (this.batchRunning) return;
          // Echo of our own write: the note was just validated, nothing else changed
          if (this.selfWrites.consume(file.path)) {
            this.decorator.decorateNow();
            return;
          }
          bumpSourceRevision();
          // Deferred: lets a burst of writes (the user's, or another plugin's
          // multi-step transaction) finish before we validate and auto-fix.
          // The decorator keeps its own frontmatter hash, so a body-only edit is a cache hit.
          if (this.settings.enableOnSave) this.changeScheduler.schedule(file);
          // Re-decorate so validator icons reflect the updated value immediately.
          // MutationObserver alone is not reliable here: Obsidian sometimes updates
          // property values in-place (no childList mutation) rather than removing and
          // re-adding the .metadata-property element.
          this.decorator.decorateNow();
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", (file: TAbstractFile) => {
          bumpSourceRevision();
          this.lastValidatedHash.delete(file.path);
          if (file instanceof TFile && this.isSchemaFile(file)) {
            this.cache.delete(file.path);
            this.resolver.rebuild();
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
          bumpSourceRevision();
          this.selfWrites.rename(oldPath, file.path);
          const hash = this.lastValidatedHash.get(oldPath);
          this.lastValidatedHash.delete(oldPath);
          if (hash !== undefined) this.lastValidatedHash.set(file.path, hash);
        })
      );

      this.registerEvent(
        this.app.vault.on("create", () => {
          bumpSourceRevision();
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
          this.basesValidator?.decorateNow();
        })
      );

      // Context menu
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string) => {
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
          if (file instanceof TFile && file.basename === "manifest" && file.extension === "md") {
            menu.addItem((item) =>
              item
                .setTitle("Edit schema")
                .setIcon("settings-2")
                .onClick(() => void this.openSchemaEditor(file.path))
            );
            return;
          }

          if (!(file instanceof TFile) || file.extension !== "md") return;

          menu.addItem((item) =>
            item
              .setTitle("Edit properties")
              .setIcon("pencil")
              .onClick(() => {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
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
                  (p) => void this.openSchemaEditor(p),
                  this.settings.enableJsExecution,
                  this
                ).open();
              })
          );

          // "Edit schema" only when there's a schema to edit
          const fmForSchema = this.app.metadataCache.getFileCache(file)?.frontmatter;
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
        activeDocument,
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

          const fm = this.app.metadataCache.getFileCache(targetFile)?.frontmatter;
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
                  (p) => void this.openSchemaEditor(p),
                  this.settings.enableJsExecution,
                  this
                ).open();
              })
          );
        })
      );

      // Right-click on wikilinks in properties panel → "Edit properties"
      this.registerDomEvent(activeDocument, "contextmenu", (e: MouseEvent) => {
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

        const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
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
                (p) => void this.openSchemaEditor(p),
                this.settings.enableJsExecution,
                this
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

  /** manifest.md or rules.md inside the schemas folder */
  private isSchemaFile(file: TFile): boolean {
    return this.cache.isManifestFile(file) || this.cache.isRulesFile(file);
  }

  /** Hash of the note's cached frontmatter, the same key the decorator uses. */
  private frontmatterHash(file: TFile): string {
    return JSON.stringify(
      sanitizeFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter)
    );
  }

  private async validateAndUpdate(file: TFile): Promise<void> {
    const previousPath = file.path;
    const hashBefore = this.frontmatterHash(file);
    const { schema, results, moved } = await validateNote(
      {
        app: this.app,
        resolver: this.resolver,
        engine: this.engine,
        writeBudget: this.writeBudget,
        selfWrites: this.selfWrites,
      },
      file
    );
    this.lastValidatedHash.delete(previousPath);
    this.lastValidatedHash.set(file.path, hashBefore);
    // Icons must reflect the post-fix state; the display cache is keyed by frontmatter only
    this.decorator.invalidate(file.path);

    if (!schema) {
      this.lastManifestByPath.delete(previousPath);
      this.badges.setStatus(file.path, "none");
      this.updateSidebarPanel(file.basename, []);
      return;
    }

    if (moved) {
      new Notice(`Moved "${file.basename}" → ${file.path}`);
      this.badges.setStatus(previousPath, "none");
    }

    // A note that changed type (different manifest, or moved by enforce_folder) may now
    // belong in a different link property of the notes pointing at it: let their rules run.
    const previousManifest = this.lastManifestByPath.get(previousPath);
    this.lastManifestByPath.delete(previousPath);
    this.lastManifestByPath.set(file.path, schema.manifestPath);
    const changedType =
      moved || (previousManifest !== undefined && previousManifest !== schema.manifestPath);
    if (changedType && this.settings.revalidateBacklinks) this.scheduleBacklinks(file);

    const errors = results.filter((r) => !r.autoFixed && r.severity === "error");
    const warnings = results.filter((r) => !r.autoFixed && r.severity === "warning");
    this.badges.setStatus(
      file.path,
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid"
    );
    if (this.settings.showFileExplorerBadges) this.badges.render();
    this.decorator.decorateNow();

    this.updateSidebarPanel(file.basename, results);
  }

  /** Queue every note that links to `file` for validation. */
  private scheduleBacklinks(file: TFile): void {
    const cache = this.app.metadataCache as unknown as {
      getBacklinksForFile?: (f: TFile) => { data?: unknown } | null;
    };
    const data = cache.getBacklinksForFile?.(file)?.data;
    const paths: string[] =
      data instanceof Map
        ? Array.from(data.keys()).filter((k): k is string => typeof k === "string")
        : data && typeof data === "object"
          ? Object.keys(data)
          : [];
    for (const path of paths) {
      const target = this.app.vault.getAbstractFileByPath(path);
      if (target instanceof TFile && target.extension === "md") {
        this.backlinkScheduler.schedule(target);
      }
    }
  }

  /** Look up the live SidebarPanel instance from the workspace — never stale. */
  private updateSidebarPanel(fileName: string, results: ValidationResult[]): void {
    this.getSidebarPanel()?.update(fileName, results);
  }

  private async validateForVaultScan(file: TFile): Promise<{
    manifestPath: string;
    manifestName: string;
    errors: number;
    warnings: number;
    issues: ValidationResult[];
  } | null> {
    const frontmatter = sanitizeFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter);
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return null;

    const results = await this.engine.validate(file, frontmatter, schema);
    appendLegacyEnforceFolderWarning(results, schema.enforce_folder, schema.manifestPath);

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
    await this.yieldScanProgressUi(true);

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
        await this.yieldScanProgressUi(processed === files.length);
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
      await this.yieldScanProgressUi(processed === files.length);
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

  /** Let the UI paint when the last frame is older than ~2 frames; cheap to call per note. */
  private async yieldScanProgressUi(force = false): Promise<void> {
    const now = performance.now();
    if (!force && now - this.lastUiYield < 32) return;
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    this.lastUiYield = performance.now();
  }

  private async applyAutoFixesAcrossVault(): Promise<void> {
    await this.reloadSchemas();
    const progress = new ProgressNotice("Applying auto-fix");
    this.batchRunning = true;

    try {
      const summary = await applyVaultAutoFixes({
        app: this.app,
        schemasRoot: this.settings.schemasRoot,
        resolver: this.resolver,
        engine: this.engine,
        selfWrites: this.selfWrites,
        onFileProcessed: ({ previousPath, filePath, status }) => {
          if (previousPath !== filePath) this.badges.setStatus(previousPath, "none");
          this.badges.setStatus(filePath, status);
        },
        onProgress: async ({ processed, total }) => {
          progress.update({ processed, total });
          // Let the notice repaint and keep the editor responsive during a long run
          await this.yieldScanProgressUi(processed === total);
        },
      });
      this.batchRunning = false;
      // Writes during the batch changed the vault; validations after it must see that
      bumpSourceRevision();

      if (this.settings.showFileExplorerBadges) this.badges.render();
      this.decorator.invalidateAll();
      this.decorator.clearIcons();
      this.decorator.decorateNow();

      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) await this.validateAndUpdate(activeFile);

      progress.finish(
        [
          `Auto-fix complete: ${summary.changed} note(s) changed`,
          `${summary.autoFixed} fix(es) applied`,
          `${summary.moved} moved`,
          `${summary.errors} error(s) remain`,
          `${summary.warnings} warning(s) remain`,
          summary.failed > 0 ? `${summary.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        6000
      );
    } catch (error) {
      progress.finish("Auto-fix failed. Check the developer console for details.", 2400);
      throw error;
    } finally {
      this.batchRunning = false;
    }
  }

  /** Return the live SidebarPanel instance, or undefined if none is open. */
  private getSidebarPanel(): SidebarPanel | undefined {
    // After a plugin reload the leaf may still hold Obsidian's placeholder view
    const view = this.app.workspace.getLeavesOfType(SIDEBAR_PANEL_TYPE)[0]?.view;
    return view instanceof SidebarPanel ? view : undefined;
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
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
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
      (p) => void this.openSchemaEditor(p),
      this.settings.enableJsExecution,
      this
    ).open();
  }

  async openSchemaEditor(manifestPath: string | null): Promise<void> {
    const { SchemaEditorModal } = await import("./ui/schema-editor-modal");

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
