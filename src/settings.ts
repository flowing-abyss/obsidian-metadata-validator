import { App, PluginSettingTab, Setting } from "obsidian";
import type MetadataValidatorPlugin from "./main";
import type { SchemaTreeView as SchemaTreeViewType } from "./ui/schema-tree";

export interface PluginSettings {
  schemasRoot: string;
  enableLiveValidation: boolean;
  enableOnSave: boolean;
  enableOnOpen: boolean;
  backgroundScanInterval: number;
  hideObsidianTypeIcon: boolean;
  hideObsidianValidator: boolean;
  showInlineErrors: boolean;
  showSidebarPanel: boolean;
  showFileExplorerBadges: boolean;
  globalPropertyOrder: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemasRoot: "schemas",
  enableLiveValidation: true,
  enableOnSave: true,
  enableOnOpen: true,
  backgroundScanInterval: 5,
  hideObsidianTypeIcon: true,
  hideObsidianValidator: true,
  showInlineErrors: true,
  showSidebarPanel: true,
  showFileExplorerBadges: true,
  globalPropertyOrder: [],
};

export class MetadataValidatorSettingTab extends PluginSettingTab {
  plugin: MetadataValidatorPlugin;

  constructor(app: App, plugin: MetadataValidatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Metadata validator").setHeading();

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

    new Setting(containerEl)
      .setName("Live validation")
      .setDesc("Validate as you type (debounced 300ms).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableLiveValidation).onChange(async (v) => {
          this.plugin.settings.enableLiveValidation = v;
          await this.plugin.saveSettings();
        })
      );

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

    new Setting(containerEl).setName("Background scan interval (minutes)").addSlider((s) =>
      s
        .setLimits(1, 60, 1)
        .setValue(this.plugin.settings.backgroundScanInterval)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.backgroundScanInterval = v;
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
        })
      );

    new Setting(containerEl).setName("Property order").setHeading();

    new Setting(containerEl)
      .setName("Global property order")
      .setDesc("Comma-separated list of property names. Applied as default order across all types.")
      .addText((text) =>
        text
          .setPlaceholder("Status, author, tags, rating")
          .setValue(this.plugin.settings.globalPropertyOrder.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.globalPropertyOrder = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Schema hierarchy").setHeading();

    const treeContainer = containerEl.createDiv("mv-schema-tree");
    this.renderTree(treeContainer);

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Refresh schemas").onClick(async () => {
        await this.plugin.reloadSchemas();
        this.renderTree(treeContainer);
      })
    );
  }

  private renderTree(container: HTMLElement): void {
    void import("./ui/schema-tree").then((mod: { SchemaTreeView: typeof SchemaTreeViewType }) => {
      new mod.SchemaTreeView(this.app, this.plugin.cache, this.plugin.resolver).render(container);
    });
  }
}
