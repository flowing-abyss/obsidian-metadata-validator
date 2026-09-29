import { type App, type EventRef, TFile } from "obsidian";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchemaResolver } from "../../schema/resolver";
import type { PluginSettings } from "../../settings";
import type { ManifestField, ResolvedSchema } from "../../types";
import { BasesDecorator } from "../bases-decorator";

const { openQuickEdit, createQuickEdit, openPicker, createPicker } = vi.hoisted(() => ({
  openQuickEdit: vi.fn(),
  createQuickEdit: vi.fn(),
  openPicker: vi.fn(),
  createPicker: vi.fn(),
}));

vi.mock("../quick-edit-modal", () => ({
  QuickEditModal: class {
    constructor(...args: unknown[]) {
      createQuickEdit(...args);
    }

    open(): void {
      openQuickEdit();
    }
  },
}));

vi.mock("../picker-modal", () => ({
  PickerModal: class {
    constructor(...args: unknown[]) {
      createPicker(...args);
    }

    open(): void {
      openPicker();
    }
  },
}));

let decorator: BasesDecorator;

function setup(valueHtml: string, field: ManifestField = { type: "number" }) {
  document.body.innerHTML = `
    <div class="bases-view">
      <div class="bases-tr">
        <div class="bases-td" data-property="file.name">
          <span class="internal-link" data-href="Notes/daily.md">daily</span>
        </div>
        <div class="bases-td" data-property="note.rating">${valueHtml}</div>
      </div>
    </div>
  `;

  const file = TFile.create__({} as never, "Notes/daily.md");
  const schema: ResolvedSchema = {
    manifestPath: "schemas/daily/manifest.md",
    rules: [],
    parseErrors: [],
    linkDependencies: [],
    inheritanceChain: ["schemas/daily/manifest.md"],
    name: "daily",
    priority: 0,
    target: {},
    fields: { rating: field },
    formatting: {},
  };
  const frontmatter = { rating: 5 };
  const listeners = new Map<EventRef, (file: TFile) => void>();
  const onChanged = vi.fn((_name: string, callback: (file: TFile) => void) => {
    const ref = {} as EventRef;
    listeners.set(ref, callback);
    return ref;
  });
  const offref = vi.fn((ref: EventRef) => listeners.delete(ref));
  const app = {
    vault: { getAbstractFileByPath: vi.fn(() => file) },
    metadataCache: { getFileCache: vi.fn(() => ({ frontmatter })), on: onChanged, offref },
  } as unknown as App;
  const resolveForNote = vi.fn<SchemaResolver["resolveForNote"]>(() => schema);
  const resolver = { resolveForNote } as unknown as SchemaResolver;
  const settings = { interceptBases: true } as PluginSettings;
  decorator = new BasesDecorator(app, resolver, settings);
  decorator.attach();

  const cell = document.querySelector<HTMLElement>("[data-property='note.rating']")!;
  return {
    app,
    file,
    frontmatter,
    schema,
    resolveForNote,
    settings,
    cell,
    listeners,
    onChanged,
    offref,
  };
}

function rightClick(target: HTMLElement): { down: MouseEvent; menu: MouseEvent } {
  const down = new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true });
  const menu = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  target.dispatchEvent(down);
  target.dispatchEvent(menu);
  return { down, menu };
}

describe("BasesDecorator", () => {
  // obsidian-test-mocks 1.1.1 installs these getters as methods. Match Obsidian's
  // actual Node.doc / Node.win properties while exercising window ownership.
  const originalDoc = Object.getOwnPropertyDescriptor(Node.prototype, "doc")!;
  const originalWin = Object.getOwnPropertyDescriptor(Node.prototype, "win")!;
  beforeAll(() => {
    Object.defineProperties(Node.prototype, {
      doc: {
        configurable: true,
        get(this: Node) {
          return this.ownerDocument ?? document;
        },
      },
      win: {
        configurable: true,
        get(this: Node) {
          return (this.ownerDocument ?? document).defaultView;
        },
      },
    });
  });
  afterAll(() => {
    Object.defineProperties(Node.prototype, { doc: originalDoc, win: originalWin });
  });

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    decorator.detach();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lets a Bases checkbox toggle without opening the quick editor", async () => {
    const { cell, resolveForNote } = setup('<input type="checkbox">', { type: "boolean" });
    const checkbox = cell.querySelector<HTMLInputElement>("input")!;

    checkbox.click();
    await vi.dynamicImportSettled();

    expect(checkbox.checked).toBe(true);
    expect(resolveForNote).not.toHaveBeenCalled();
    expect(openQuickEdit).not.toHaveBeenCalled();
  });

  it.each([
    '<input type="number" value="5">',
    '<input type="number" value="5" contenteditable="false">',
    '<input type="number">',
    '<input type="text" value="daily">',
    "<textarea>daily</textarea>",
    '<div contenteditable="true"><span>daily</span></div>',
  ])("leaves native editor left clicks alone: %s", async (html) => {
    const { cell } = setup(html);
    const target = cell.querySelector<HTMLElement>("span, input, textarea")!;
    const nativeClick = vi.fn();
    cell.addEventListener("click", nativeClick);
    const event = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true });

    target.dispatchEvent(event);
    await vi.dynamicImportSettled();

    expect(nativeClick).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    expect(openQuickEdit).not.toHaveBeenCalled();
    expect(openPicker).not.toHaveBeenCalled();
  });

  it.each(["5", ""])(
    "opens the number modal on right-click without starting a native edit (value: %s)",
    async (value) => {
      // Bases registers document capture handlers before the plugin is attached.
      const nativeMouseDown = vi.fn();
      document.addEventListener("mousedown", nativeMouseDown, { capture: true });
      const { app, file, schema, cell } = setup(`<input type="number" value="${value}">`);
      try {
        const { down, menu } = rightClick(cell.querySelector<HTMLInputElement>("input")!);
        await vi.dynamicImportSettled();

        expect(nativeMouseDown).not.toHaveBeenCalled();
        expect(down.defaultPrevented).toBe(true);
        expect(menu.defaultPrevented).toBe(true);
        expect(openQuickEdit).toHaveBeenCalledOnce();
        expect(createQuickEdit).toHaveBeenCalledWith(app, file, "rating", schema.fields.rating, 5);
      } finally {
        document.removeEventListener("mousedown", nativeMouseDown, { capture: true });
      }
    }
  );

  it("cancels a focused native edit before opening the modal with fresh metadata", async () => {
    const { app, file, schema, cell, frontmatter } = setup('<input type="number" value="5">');
    const input = cell.querySelector<HTMLInputElement>("input")!;
    const escape = vi.fn((event: KeyboardEvent) => {
      if (event.key === "Escape") {
        expect(openQuickEdit).not.toHaveBeenCalled();
        frontmatter.rating = 6;
      }
    });
    input.addEventListener("keydown", escape);
    input.focus();

    rightClick(input);
    await vi.dynamicImportSettled();

    expect(escape).toHaveBeenCalledOnce();
    expect(createQuickEdit).toHaveBeenCalledWith(app, file, "rating", schema.fields.rating, 6);
  });

  it("still opens the number modal from empty cell padding", async () => {
    const { cell } = setup('<input type="number">');

    rightClick(cell);
    await vi.dynamicImportSettled();

    expect(openQuickEdit).toHaveBeenCalledOnce();
  });

  it.each(["disabled", "no schema", "unknown field"])(
    "preserves native right-clicks when the plugin does not handle the field: %s",
    async (reason) => {
      const { settings, schema, resolveForNote, cell } = setup('<input type="number">');
      if (reason === "disabled") settings.interceptBases = false;
      if (reason === "no schema") resolveForNote.mockReturnValue(null);
      if (reason === "unknown field") schema.fields = {};
      const nativeMouseDown = vi.fn();
      cell.addEventListener("mousedown", nativeMouseDown);

      const { down, menu } = rightClick(cell);
      await vi.dynamicImportSettled();

      expect(nativeMouseDown).toHaveBeenCalledOnce();
      expect(down.defaultPrevented).toBe(false);
      expect(menu.defaultPrevented).toBe(false);
      expect(openQuickEdit).not.toHaveBeenCalled();
    }
  );

  it.each([
    '<input type="checkbox">',
    '<span role="checkbox"><span>reviewed</span></span>',
    '<span data-href="Notes/linked.md">linked</span>',
    '<a href="https://example.com">linked</a>',
    '<span class="multi-select-pill">value</span>',
  ])("preserves native right-clicks on checkboxes, links, and chips: %s", async (html) => {
    const { cell } = setup(html);
    const nativeMouseDown = vi.fn();
    cell.addEventListener("mousedown", nativeMouseDown);

    const { menu } = rightClick(cell.firstElementChild as HTMLElement);
    await vi.dynamicImportSettled();

    expect(nativeMouseDown).toHaveBeenCalledOnce();
    expect(menu.defaultPrevented).toBe(false);
    expect(openQuickEdit).not.toHaveBeenCalled();
  });

  it("still opens the picker when left-clicking a value chip", async () => {
    const { cell } = setup('<span class="multi-select-pill">daily</span>', { type: "select" });

    (cell.firstElementChild as HTMLElement).click();
    await vi.dynamicImportSettled();

    expect(openPicker).toHaveBeenCalledOnce();
    expect(openQuickEdit).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps chip clicks intact inside an editable parent (embed boundary: %s)",
    async (boundary) => {
      const { cell } = setup('<span class="multi-select-pill">daily</span>', { type: "select" });
      const bases = cell.closest<HTMLElement>(".bases-view")!;
      const editor = document.createElement("div");
      editor.className = "cm-content";
      editor.contentEditable = "true";
      editor.setAttribute("contenteditable", "true");
      if (boundary) bases.setAttribute("contenteditable", "false");
      document.body.appendChild(editor);
      editor.appendChild(bases);
      const chip = cell.firstElementChild as HTMLElement;

      chip.click();
      await vi.dynamicImportSettled();
      expect(openPicker).toHaveBeenCalledOnce();

      const { down, menu } = rightClick(chip);
      await vi.dynamicImportSettled();
      expect(down.defaultPrevented).toBe(false);
      expect(menu.defaultPrevented).toBe(false);
      expect(openPicker).toHaveBeenCalledOnce();
    }
  );

  it("attaches only once and removes listeners from their original document", async () => {
    const { cell } = setup("<span>daily</span>", { type: "select" });
    const remove = vi.spyOn(document.body, "removeEventListener");
    decorator.attach();
    (cell.firstElementChild as HTMLElement).click();
    await vi.dynamicImportSettled();
    expect(openPicker).toHaveBeenCalledOnce();

    vi.stubGlobal("activeDocument", document.implementation.createHTMLDocument("Another window"));
    decorator.detach();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function), { capture: true });
    expect(remove).toHaveBeenCalledWith("contextmenu", expect.any(Function), { capture: true });
    (cell.firstElementChild as HTMLElement).click();
    await vi.dynamicImportSettled();
    expect(openPicker).toHaveBeenCalledOnce();
  });

  it("cancels a queued modal frame when detached", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frames.push(callback);
      return 42;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { cell } = setup('<input type="number">');

    rightClick(cell);
    decorator.detach();
    expect(cancel).toHaveBeenCalledWith(42);
    frames[0]?.(0);
    await vi.dynamicImportSettled();
    expect(openQuickEdit).not.toHaveBeenCalled();
  });

  it("uses the attached document's window for the mousedown gate", async () => {
    const { cell } = setup('<input type="number">');
    decorator.detach();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const otherDocument = frame.contentDocument!;
    const otherWindow = frame.contentWindow!;
    Object.defineProperty(otherDocument.body, "win", { value: otherWindow });
    otherDocument.body.appendChild(cell.closest(".bases-view")!);
    vi.stubGlobal("activeDocument", otherDocument);
    decorator.attach();
    const nativeMouseDown = vi.fn();
    otherDocument.addEventListener("mousedown", nativeMouseDown);
    const event = new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true });

    cell.querySelector("input")!.dispatchEvent(event);

    expect(nativeMouseDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("releases an expired save watcher without retaining its cleanup until detach", async () => {
    const { cell, listeners, offref } = setup("<span>daily</span>", { type: "select" });
    rightClick(cell);
    await vi.dynamicImportSettled();
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    try {
      const onSaved = createPicker.mock.calls[0]?.[6] as (value: unknown) => void;
      onSaved("daily");
      expect(listeners.size).toBe(1);

      vi.advanceTimersByTime(3100);
      expect(listeners.size).toBe(0);
      expect(offref).toHaveBeenCalledOnce();
      expect(clearTimeout).toHaveBeenCalledOnce();
      decorator.detach();
      expect(clearTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["left", "right"])(
    "does not open a pending %s-click modal after detach and reattach",
    async (button) => {
      const { cell } = setup("<span>daily</span>", { type: "select" });
      if (button === "left") (cell.firstElementChild as HTMLElement).click();
      else rightClick(cell);

      decorator.detach();
      decorator.attach();
      await vi.dynamicImportSettled();
      expect(openPicker).not.toHaveBeenCalled();
    }
  );

  it("cleans up temporary save watchers and rejects save callbacks after detach", async () => {
    const { cell, listeners, onChanged, offref } = setup("<span>daily</span>", { type: "select" });
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    rightClick(cell);
    await vi.dynamicImportSettled();
    const onSaved = createPicker.mock.calls[0]?.[6] as (value: unknown) => void;

    onSaved("daily");
    expect(listeners.size).toBe(1);
    decorator.detach();
    expect(offref).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(clearTimeout).toHaveBeenCalled();

    onSaved("another value");
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
