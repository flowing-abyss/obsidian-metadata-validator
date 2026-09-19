import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type MetadataValidatorPlugin from "./main";
import type { SchemaTreeView as SchemaTreeViewType } from "./ui/schema-tree";

export interface PluginSettings {
  schemasRoot: string;
  enableOnSave: boolean;
  /** Quiet period after a note changes before it is validated and auto-fixed */
  onSaveDelaySeconds: number;
  enableOnOpen: boolean;
  /** When a note's schema changes, re-validate the notes linking to it */
  revalidateBacklinks: boolean;
  hideObsidianTypeIcon: boolean;
  hideObsidianValidator: boolean;
  showInlineErrors: boolean;
  showSidebarPanel: boolean;
  showFileExplorerBadges: boolean;
  interceptBases: boolean;
  showBasesErrors: boolean;
  enableJsExecution: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemasRoot: "schemas",
  enableOnSave: true,
  onSaveDelaySeconds: 1,
  enableOnOpen: true,
  revalidateBacklinks: true,
  hideObsidianTypeIcon: true,
  hideObsidianValidator: true,
  showInlineErrors: true,
  showSidebarPanel: true,
  showFileExplorerBadges: true,
  interceptBases: true,
  showBasesErrors: true,
  enableJsExecution: false,
};

type ToggleKey = {
  [K in keyof PluginSettings]: PluginSettings[K] extends boolean ? K : never;
}[keyof PluginSettings];

interface SettingRow {
  name: string;
  desc?: string;
  build: (setting: Setting) => unknown;
}

interface SettingSection {
  heading: string;
  rows: SettingRow[];
}

export class MetadataValidatorSettingTab extends PluginSettingTab {
  plugin: MetadataValidatorPlugin;
  private treeContainer: HTMLElement | null = null;

  constructor(app: App, plugin: MetadataValidatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Re-render the schema tree if the settings panel is currently open. */
  refreshTree(): void {
    if (this.treeContainer?.isConnected) {
      this.renderTree(this.treeContainer);
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map(({ heading, rows }) => ({
      type: "group" as const,
      heading,
      items: rows.map(({ name, desc, build }) => ({
        name,
        desc,
        searchable: name !== "",
        render: (setting: Setting) => {
          this.describe(setting, name, desc);
          build(setting);
        },
      })),
    }));
  }

  /** Fallback for Obsidian before 1.13.0, which renders the tab imperatively. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const { heading, rows } of this.sections()) {
      new Setting(containerEl).setName(heading).setHeading();
      for (const { name, desc, build } of rows) {
        build(this.describe(new Setting(containerEl), name, desc));
      }
    }
  }

  private describe(setting: Setting, name: string, desc?: string): Setting {
    if (name) setting.setName(name);
    if (desc) setting.setDesc(desc);
    return setting;
  }

  private toggle(
    key: ToggleKey,
    name: string,
    desc?: string,
    after?: (value: boolean) => void
  ): SettingRow {
    return {
      name,
      desc,
      build: (setting) =>
        setting.addToggle((t) =>
          t.setValue(this.plugin.settings[key]).onChange(async (v) => {
            this.plugin.settings[key] = v;
            await this.plugin.saveSettings();
            after?.(v);
          })
        ),
    };
  }

  private sections(): SettingSection[] {
    return [
      {
        heading: "Schemas",
        rows: [
          {
            name: "Schemas folder",
            desc: "Vault path to the folder containing all manifest.md files.",
            build: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder("Schemas")
                  .setValue(this.plugin.settings.schemasRoot)
                  .onChange(async (value) => {
                    this.plugin.settings.schemasRoot = value.trim();
                    await this.plugin.saveSettings();
                    await this.plugin.reloadSchemas();
                  })
              ),
          },
        ],
      },
      {
        heading: "Validation timing",
        rows: [
          this.toggle(
            "enableOnSave",
            "Validate on save",
            "Validate and auto-fix a note whenever its file changes on disk — from the editor or from other plugins."
          ),
          {
            name: "Delay after change",
            desc: "Seconds to wait after a note changes before validating it. A burst of edits — yours or another plugin's — is validated once, after it settles.",
            build: (setting) =>
              setting.addSlider((s) =>
                s
                  .setLimits(0, 10, 0.5)
                  .setValue(this.plugin.settings.onSaveDelaySeconds)
                  .onChange(async (v) => {
                    this.plugin.settings.onSaveDelaySeconds = v;
                    await this.plugin.saveSettings();
                  })
              ),
          },
          this.toggle("enableOnOpen", "Validate on open"),
          this.toggle(
            "revalidateBacklinks",
            "Revalidate notes that depend on a changed note",
            "When a note changes, the notes whose rules read it through a link are validated again, for example a task that follows its project, or a link that belongs in another property once the note changed type."
          ),
        ],
      },
      {
        heading: "UI",
        rows: [
          this.toggle(
            "hideObsidianTypeIcon",
            "Hide Obsidian property type icon",
            "Hides the icons that Obsidian shows to the left of each property name.",
            () => this.plugin.cssInjector.update()
          ),
          this.toggle(
            "hideObsidianValidator",
            "Hide Obsidian native validator",
            "Hides the warning triangle Obsidian adds when a property value has a type mismatch.",
            () => this.plugin.cssInjector.update()
          ),
          this.toggle(
            "showInlineErrors",
            "Show inline validation icons",
            "Inject picker and validator icons into the properties panel."
          ),
          this.toggle("showSidebarPanel", "Show sidebar panel"),
          this.toggle(
            "showFileExplorerBadges",
            "Show file explorer badges",
            "Color dots on file names: red = errors, yellow = warnings, green = valid.",
            (v) => {
              if (v) this.plugin.badges.render();
              else this.plugin.badges.clearAll();
            }
          ),
          this.toggle(
            "interceptBases",
            "Intercept Bases clicks",
            "Open picker / quick-edit when clicking a schema field in a Bases table."
          ),
          this.toggle(
            "showBasesErrors",
            "Show validation errors in Bases",
            "Highlight invalid cells with a subtle border and hover tooltip.",
            (v) =>
              (
                this.plugin as unknown as { toggleBasesValidator?: (v: boolean) => void }
              ).toggleBasesValidator?.(v)
          ),
        ],
      },
      {
        heading: "Security",
        rows: [
          this.toggle(
            "enableJsExecution",
            "Allow JavaScript execution",
            "Enables custom JavaScript sources and validators in schemas. Warning: this executes JavaScript code written in your schema files. Only enable if you trust the code in your vault."
          ),
        ],
      },
      {
        heading: "Schema hierarchy",
        rows: [
          {
            name: "",
            build: (setting) => {
              setting.settingEl.empty();
              this.treeContainer = setting.settingEl.createDiv("mv-schema-tree");
              this.renderTree(this.treeContainer);
            },
          },
          {
            name: "",
            build: (setting) =>
              setting.addButton((btn) =>
                btn
                  .setButtonText("New schema")
                  .onClick(() => void this.plugin.openSchemaEditor(null))
              ),
          },
        ],
      },
    ];
  }

  private renderTree(container: HTMLElement): void {
    void import("./ui/schema-tree").then((mod: { SchemaTreeView: typeof SchemaTreeViewType }) => {
      new mod.SchemaTreeView(
        this.app,
        this.plugin.cache,
        this.plugin.resolver,
        (path) => void this.plugin.openSchemaEditor(path)
      ).render(container);
    });
  }

  override hide(): void {
    this.treeContainer = null;
  }
}
