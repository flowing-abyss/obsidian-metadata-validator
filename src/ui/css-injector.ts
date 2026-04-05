import type { PluginSettings } from "../settings";

const HIDE_TYPE_ICON_CLASS = "mv-hide-type-icon";
const HIDE_VALIDATOR_CLASS = "mv-hide-validator";

export class CssInjector {
  private readonly settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  update(): void {
    document.body.toggleClass(HIDE_TYPE_ICON_CLASS, this.settings.hideObsidianTypeIcon);
    document.body.toggleClass(HIDE_VALIDATOR_CLASS, this.settings.hideObsidianValidator);
  }

  remove(): void {
    document.body.removeClass(HIDE_TYPE_ICON_CLASS);
    document.body.removeClass(HIDE_VALIDATOR_CLASS);
  }
}
