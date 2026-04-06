import type { PluginSettings } from "../settings";

const STYLE_ID = "mv-css-overrides";

export class CssInjector {
  private readonly settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  update(): void {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      // eslint-disable-next-line obsidianmd/no-forbidden-elements -- dynamic CSS required for runtime setting toggles
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }

    const rules: string[] = [];

    if (this.settings.hideObsidianTypeIcon) {
      rules.push(
        // All known selectors for the property type icon across Obsidian versions
        ".metadata-property-icon { display: none !important; }",
        ".metadata-property-icon svg { display: none !important; }",
        ".metadata-property-type-icon { display: none !important; }"
      );
    }

    if (this.settings.hideObsidianValidator) {
      rules.push(
        // Invalid-property warning indicators
        ".metadata-property-invalid-icon { display: none !important; }",
        '.metadata-property[data-property-type="invalid"] .metadata-property-icon { display: none !important; }',
        '.metadata-property[data-property-type="invalid"] .metadata-property-value::after { display: none !important; }'
      );
    }

    el.textContent = rules.join("\n");
  }

  remove(): void {
    document.getElementById(STYLE_ID)?.remove();
  }
}
