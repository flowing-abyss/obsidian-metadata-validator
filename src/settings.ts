// Placeholder — full settings implemented in Task 12 of the implementation plan.
// This file exists to satisfy the import in main.ts until the plan is executed.

import { App, PluginSettingTab } from "obsidian";
import type MetadataValidatorPlugin from "./main";

export interface PluginSettings {
  schemasRoot: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  schemasRoot: "schemas",
};

export class MetadataValidatorSettingTab extends PluginSettingTab {
  plugin: MetadataValidatorPlugin;

  constructor(app: App, plugin: MetadataValidatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
  }
}
