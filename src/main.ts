// Placeholder — full implementation in Task 19 of the implementation plan.
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MetadataValidatorSettingTab, type PluginSettings } from "./settings";

export default class MetadataValidatorPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MetadataValidatorSettingTab(this.app, this));
  }

  onunload(): void {}

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
