import type { Command, Plugin, TFile } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import type { SchemaResolver } from "../../schema/resolver";
import type { ResolvedSchema } from "../../types";
import { PropertySuggestModal } from "../../ui/property-suggest-modal";
import { registerKeyboardPropertiesCommand } from "../keyboard-properties";

afterEach(() => vi.restoreAllMocks());

it("registers a separate command, checks the active note, and edits the originally selected note", () => {
  let active: TFile | null = null;
  let command: Command;
  let selector: PropertySuggestModal;
  const schema = { fields: { title: { type: "text" } }, formatting: {} } as ResolvedSchema;
  const resolver = { resolveForNote: vi.fn(() => schema) } as unknown as SchemaResolver;
  const cache = vi.fn(() => ({ frontmatter: { title: "Original" } }));
  const plugin = {
    app: { workspace: { getActiveFile: () => active }, metadataCache: { getFileCache: cache } },
    register: vi.fn(),
    addCommand: (value: Command) => {
      command = value;
    },
  } as unknown as Plugin;
  vi.spyOn(PropertySuggestModal.prototype, "open").mockImplementation(function () {
    selector = this;
  });
  registerKeyboardPropertiesCommand(plugin, resolver, () => false);
  expect(command!.id).toBe("edit-properties-keyboard");
  expect(command!.checkCallback!(true)).toBe(false);
  active = { path: "first.md", basename: "first", extension: "md" } as TFile;
  const original = active;
  expect(command!.checkCallback!(true)).toBe(true);
  expect(resolver.resolveForNote).not.toHaveBeenCalled();
  command!.checkCallback!(false);
  active = { path: "second.md", basename: "second", extension: "md" } as TFile;
  selector!.onChooseItem(selector!.getItems()[0]!);
  expect(cache).toHaveBeenLastCalledWith(original);
  expect(selector!.inputEl.value).toBe("Original");
});

it("forcibly disposes the previous prompt on replacement and on plugin unload", () => {
  let command!: Command;
  let unload!: () => void;
  const prompts: PropertySuggestModal[] = [];
  const file = { path: "note.md", basename: "note", extension: "md" } as TFile;
  const schema = { fields: {}, formatting: {} } as ResolvedSchema;
  const plugin = {
    app: {
      workspace: { getActiveFile: () => file },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    },
    register: (cleanup: () => void) => {
      unload = cleanup;
    },
    addCommand: (value: Command) => {
      command = value;
    },
  } as unknown as Plugin;
  vi.spyOn(PropertySuggestModal.prototype, "open").mockImplementation(function () {
    prompts.push(this);
  });
  const dispose = vi.spyOn(PropertySuggestModal.prototype, "dispose").mockImplementation(() => {});
  registerKeyboardPropertiesCommand(
    plugin,
    { resolveForNote: () => schema } as unknown as SchemaResolver,
    () => false
  );
  command.checkCallback!(false);
  command.checkCallback!(false);
  expect(dispose.mock.contexts).toEqual([prompts[0]]);
  unload();
  expect(dispose.mock.contexts).toEqual(prompts);
});
