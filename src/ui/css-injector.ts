import type { PluginSettings } from "../settings";

export class CssInjector {
  private readonly settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  update(): void {
    activeDocument.body.toggleClass("mv-hide-type-icon", this.settings.hideObsidianTypeIcon);
    activeDocument.body.toggleClass("mv-hide-validator", this.settings.hideObsidianValidator);
  }

  remove(): void {
    activeDocument.body.removeClass("mv-hide-type-icon");
    activeDocument.body.removeClass("mv-hide-validator");
  }
}
