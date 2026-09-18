import type { SourceResolutionResult } from "../../schema/source-resolver";
import type { App, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSchema, KeyboardPropertyItem } from "../../types";
import { PropertySuggestModal } from "../property-suggest-modal";
import { propertySuggestions } from "../property-suggestions";
import * as optionSource from "../../schema/field-options";

const schema: ResolvedSchema = {
  name: "Book",
  manifestPath: "schemas/book/manifest.md",
  rules: [],
  inheritanceChain: [],
  priority: 0,
  target: {},
  fields: {
    status: {
      type: "select",
      label: "Status",
      options: [
        { value: "done", label: "Done" },
        { value: "todo", label: "To do" },
      ],
      description: "The reading stage.",
    },
    aliases: { type: "list", required: true },
    description: { type: "text" },
    topics: { type: "multiselect", options: [{ value: "a" }, { value: "b" }] },
    icon: { type: "text", hidden: true },
    fixed: { type: "text", fixed: "Constant" },
    date: { type: "date", format: "DD/MM/YYYY" },
  },
  formatting: { property_order: ["aliases", "description", "status", "gone", "aliases"] },
};
function setup() {
  const fm: Record<string, unknown> = {
    status: "done",
    aliases: ["First"],
    description: "Original",
    topics: ["a"],
  };
  const write = vi.fn(async (_file: TFile, edit: (fm: Record<string, unknown>) => void) =>
    edit(fm)
  );
  let changed: ((file: TFile) => void) | undefined;
  const app = {
    metadataCache: {
      getFileCache: () => ({ frontmatter: fm }),
      on: vi.fn((_name, callback: (file: TFile) => void) => {
        changed = callback;
        return {};
      }),
      offref: vi.fn(),
    },
    fileManager: { processFrontMatter: write },
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
  } as unknown as App;
  const modal = new PropertySuggestModal(
    app,
    { basename: "Example", path: "example.md" } as TFile,
    schema
  );
  const choose = (item: KeyboardPropertyItem) =>
    modal.selectSuggestion({ item, match: { score: 0, matches: [] } });
  const open = async (key: string) => {
    choose(modal.getItems().find((item) => item.kind === "property" && item.property.key === key)!);
    await Promise.resolve();
    await Promise.resolve();
  };
  const back = () => (modal as unknown as { back: () => Promise<void> }).back();
  const finish = () => (modal as unknown as { finish: () => Promise<void> }).finish();
  return {
    modal,
    fm,
    write,
    choose,
    open,
    back,
    finish,
    change: () => changed?.({ path: "example.md" } as TFile),
  };
}

afterEach(() => document.body.replaceChildren());

describe("single-window keyboard properties", () => {
  it("keeps fixed properties visible without editable actions or writes", async () => {
    const { modal, open, choose, finish, write, back } = setup();
    await open("fixed");
    expect(modal.getSuggestions("anything")[0]?.item).toMatchObject({
      action: "message",
      label: "Fixed value",
      description: "Constant",
    });
    modal.inputEl.value = "Replacement";
    choose({ kind: "action", action: "save", label: "Save" });
    await finish();
    expect(write).not.toHaveBeenCalled();
    await back();
    expect(
      modal.getItems().some((item) => item.kind === "property" && item.property.key === "fixed")
    ).toBe(true);
  });

  it("uses fresh metadata after external changes and unregisters its listener", async () => {
    const { modal, open, finish, fm, change } = setup();
    modal.open();
    await open("description");
    modal.inputEl.value = "Saved";
    await finish();
    fm.description = "External change";
    change();
    await open("description");
    expect(modal.inputEl.value).toBe("External change");
    modal.dispose();
    expect(modal.app.metadataCache.offref).toHaveBeenCalledTimes(1);
  });

  it("retains a just-saved value only while the metadata cache catches up", async () => {
    const { modal, open, finish, fm, change } = setup();
    modal.open();
    await open("description");
    modal.inputEl.value = "Saved";
    await finish();
    fm.description = "Old cache";
    await open("description");
    expect(modal.inputEl.value).toBe("Saved");
    fm.description = "Saved";
    change();
    modal.dispose();
  });

  it("immediately tears down during a pending save without a late refresh", async () => {
    const { modal, open, finish, write } = setup();
    modal.open();
    await open("description");
    let resolve!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    modal.inputEl.value = "Saved";
    const pending = finish();
    modal.dispose();
    expect(modal.containerEl.isConnected).toBe(false);
    resolve();
    await pending;
    expect(modal.getItems()[0]?.kind).toBe("action");
    expect(modal.app.metadataCache.offref).toHaveBeenCalledTimes(1);
  });

  it("tears down a dirty draft even when persistence fails", async () => {
    const { modal, open, choose, write } = setup();
    modal.open();
    await open("topics");
    choose(modal.getItems().find((item) => item.kind === "option" && item.option.value === "b")!);
    write.mockRejectedValueOnce(new Error("Save failed"));
    modal.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(modal.containerEl.isConnected).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(modal.app.metadataCache.offref).toHaveBeenCalledTimes(1);
  });

  it("removes a single value from the selected section with one selection", async () => {
    const { modal, open, choose, fm } = setup();
    await open("status");
    const selected = modal.getSuggestions("")[0]!.item;
    expect(selected.pinned).toBe(true);
    choose(selected);
    await Promise.resolve();
    await Promise.resolve();
    expect(fm).not.toHaveProperty("status");
    expect(modal.getItems()[0]?.kind).toBe("property");
  });

  it("saves a date shortcut in the same prompt using the manifest format", async () => {
    const { modal, open, choose, fm } = setup();
    await open("date");
    const item = modal.getItems().find((item) => item.label === "Tomorrow")!;
    expect(item.kind).toBe("action");
    choose(item);
    await Promise.resolve();
    await Promise.resolve();
    expect(fm.date).toBe(item.kind === "action" && item.value);
    expect(modal.getItems()[0]?.kind).toBe("property");
  });
  it("opens the calendar inside the existing prompt and cleans up its scope", async () => {
    const { modal, open, choose, fm } = setup();
    await open("date");
    const container = modal.modalEl;
    choose(modal.getItems().find((item) => item.kind === "action" && item.action === "calendar")!);
    expect(modal.modalEl).toBe(container);
    expect(modal.getSuggestions("")).toEqual([]);
    const day = modal.modalEl.querySelector<HTMLButtonElement>("[data-date][tabindex='0']")!;
    day.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(fm.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(modal.app.keymap.popScope).toHaveBeenCalledTimes(1);
  });

  it("lists only names, descriptions and types without value previews", () => {
    expect(propertySuggestions(schema).map((item) => item.key)).toEqual([
      "aliases",
      "description",
      "status",
      "topics",
      "fixed",
      "date",
    ]);
    const { modal } = setup();
    const item = modal
      .getItems()
      .find((item) => item.kind === "property" && item.property.key === "status")!;
    expect(modal.getItemText(item)).toBe("Status The reading stage. status");
    expect(item).not.toHaveProperty("preview");
  });
  it("edits and saves a scalar in the same modal, restoring the property query", async () => {
    const { modal, open, finish, fm, write } = setup();
    const container = modal.modalEl;
    const close = vi.spyOn(modal, "close");
    modal.inputEl.value = "description";
    await open("description");
    expect(modal.modalEl).toBe(container);
    expect(modal.inputEl.value).toBe("Original");
    modal.inputEl.value = "Revised";
    await finish();
    expect(fm.description).toBe("Revised");
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(modal.getItems()[0]?.kind).toBe("property");
    expect(modal.inputEl.value).toBe("description");
  });
  it("cancels scalar edits on back without writing", async () => {
    const { modal, open, back, fm, write } = setup();
    await open("description");
    modal.inputEl.value = "Discard";
    await back();
    expect(fm.description).toBe("Original");
    expect(write).not.toHaveBeenCalled();
  });
  it("toggles multiple choices without leaving the prompt and commits on back", async () => {
    const { modal, open, back, choose, fm, write } = setup();
    await open("topics");
    const container = modal.modalEl;
    choose(modal.getItems().find((item) => item.kind === "option" && item.option.value === "b")!);
    expect(modal.getItems()[0]?.kind).toBe("option");
    expect(write).not.toHaveBeenCalled();
    await back();
    expect(fm.topics).toEqual(["a", "b"]);
    expect(modal.modalEl).toBe(container);
    expect(modal.getItems()[0]?.kind).toBe("property");
  });
  it("adds and removes free-list values inside the same prompt", async () => {
    const { modal, open, choose, back, fm } = setup();
    await open("aliases");
    choose({ kind: "action", action: "add", value: "Second", label: "Add Second" });
    choose(
      modal.getItems().find((item) => item.kind === "option" && item.option.value === "First")!
    );
    await back();
    expect(fm.aliases).toEqual(["Second"]);
  });
  it("does not replace the property screen when a late option source resolves", async () => {
    let resolve!: (result: SourceResolutionResult) => void;
    const pending = new Promise<SourceResolutionResult>((done) => {
      resolve = done;
    });
    const spy = vi.spyOn(optionSource, "loadFieldOptions").mockReturnValueOnce(pending);
    try {
      const { modal, open, back } = setup();
      await open("topics");
      await back();
      resolve({ status: "resolved", options: [{ value: "late" }] });
      await Promise.resolve();
      await Promise.resolve();
      expect(modal.getItems()[0]?.kind).toBe("property");
    } finally {
      spy.mockRestore();
    }
  });
});
