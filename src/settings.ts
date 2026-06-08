import { App, PluginSettingTab, Setting } from "obsidian";
import type MetadataValidatorPlugin from "./main";
import type { SchemaTreeView as SchemaTreeViewType } from "./ui/schema-tree";

export interface PluginSettings {
  schemasRoot: string;
  enableOnSave: boolean;
  enableOnOpen: boolean;
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
  enableOnOpen: true,
  hideObsidianTypeIcon: true,
  hideObsidianValidator: true,
  showInlineErrors: true,
  showSidebarPanel: true,
  showFileExplorerBadges: true,
  interceptBases: true,
  showBasesErrors: true,
  enableJsExecution: false,
};

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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Schemas").setHeading();

    new Setting(containerEl)
      .setName("Schemas folder")
      .setDesc("Vault path to the folder containing all manifest.md files.")
      .addText((text) =>
        text
          .setPlaceholder("Schemas")
          .setValue(this.plugin.settings.schemasRoot)
          .onChange(async (value) => {
            this.plugin.settings.schemasRoot = value.trim();
            await this.plugin.saveSettings();
            await this.plugin.reloadSchemas();
          })
      );

    new Setting(containerEl).setName("Validation timing").setHeading();

    new Setting(containerEl).setName("Validate on save").addToggle((t) =>
      t.setValue(this.plugin.settings.enableOnSave).onChange(async (v) => {
        this.plugin.settings.enableOnSave = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("Validate on open").addToggle((t) =>
      t.setValue(this.plugin.settings.enableOnOpen).onChange(async (v) => {
        this.plugin.settings.enableOnOpen = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl).setName("UI").setHeading();

    new Setting(containerEl)
      .setName("Hide Obsidian property type icon")
      .setDesc("Hides the icons that Obsidian shows to the left of each property name.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hideObsidianTypeIcon).onChange(async (v) => {
          this.plugin.settings.hideObsidianTypeIcon = v;
          await this.plugin.saveSettings();
          this.plugin.cssInjector.update();
        })
      );

    new Setting(containerEl)
      .setName("Hide Obsidian native validator")
      .setDesc(
        "Hides the warning triangle Obsidian adds when a property value has a type mismatch."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hideObsidianValidator).onChange(async (v) => {
          this.plugin.settings.hideObsidianValidator = v;
          await this.plugin.saveSettings();
          this.plugin.cssInjector.update();
        })
      );

    new Setting(containerEl)
      .setName("Show inline validation icons")
      .setDesc("Inject picker and validator icons into the properties panel.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showInlineErrors).onChange(async (v) => {
          this.plugin.settings.showInlineErrors = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Show sidebar panel").addToggle((t) =>
      t.setValue(this.plugin.settings.showSidebarPanel).onChange(async (v) => {
        this.plugin.settings.showSidebarPanel = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl)
      .setName("Show file explorer badges")
      .setDesc("Color dots on file names: red = errors, yellow = warnings, green = valid.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showFileExplorerBadges).onChange(async (v) => {
          this.plugin.settings.showFileExplorerBadges = v;
          await this.plugin.saveSettings();
          if (v) this.plugin.badges.render();
          else this.plugin.badges.clearAll();
        })
      );

    new Setting(containerEl)
      .setName("Intercept Bases clicks")
      .setDesc("Open picker / quick-edit when clicking a schema field in a Bases table.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.interceptBases).onChange(async (v) => {
          this.plugin.settings.interceptBases = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show validation errors in Bases")
      .setDesc("Highlight invalid cells with a subtle border and hover tooltip.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showBasesErrors).onChange(async (v) => {
          this.plugin.settings.showBasesErrors = v;
          await this.plugin.saveSettings();
          (
            this.plugin as unknown as { toggleBasesValidator?: (v: boolean) => void }
          ).toggleBasesValidator?.(v);
        })
      );

    new Setting(containerEl).setName("Security").setHeading();

    new Setting(containerEl)
      .setName("Allow JavaScript execution")
      .setDesc(
        "Enables custom JavaScript sources and validators in schemas. Warning: this executes JavaScript code written in your schema files. Only enable if you trust the code in your vault."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableJsExecution).onChange(async (v) => {
          this.plugin.settings.enableJsExecution = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Schema hierarchy").setHeading();

    this.treeContainer = containerEl.createDiv("mv-schema-tree");
    this.renderTree(this.treeContainer);

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("New schema").onClick(() => void this.plugin.openSchemaEditor(null))
    );
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
