import type { PluginSettings } from "../settings";

export class CssInjector {
  private readonly settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  update(): void {
    document.body.toggleClass("mv-hide-type-icon", this.settings.hideObsidianTypeIcon);
    document.body.toggleClass("mv-hide-validator", this.settings.hideObsidianValidator);
  }

  remove(): void {
    document.body.removeClass("mv-hide-type-icon");
    document.body.removeClass("mv-hide-validator");
  }
}
