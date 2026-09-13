import { Notice } from "obsidian";
import type { Plugin } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import { PropertySuggestModal } from "../ui/property-suggest-modal";

export function registerKeyboardPropertiesCommand(
  plugin: Plugin,
  resolver: SchemaResolver,
  enableJs: () => boolean
): void {
  let activeModal: PropertySuggestModal | null = null;
  const open = (modal: PropertySuggestModal) => {
    activeModal?.dispose();
    activeModal = modal;
    modal.open();
  };
  plugin.register(() => {
    activeModal?.dispose();
    activeModal = null;
  });
  plugin.addCommand({
    id: "edit-properties-keyboard",
    name: "Edit properties with keyboard",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (checking) return true;
      const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const schema = resolver.resolveForNote(file, frontmatter);
      if (!schema) {
        new Notice("No schema matches this note.");
        return true;
      }
      open(new PropertySuggestModal(plugin.app, file, schema, enableJs()));
      return true;
    },
  });
}
