import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { FieldOption, ManifestField, ResolvedSchema } from "../../types";
import { PickerModal } from "../picker-modal";

function makeModal(field: Partial<ManifestField>, currentValue: unknown, enableJs = false) {
  const app = {} as App;
  const file = { path: "test.md", basename: "test", extension: "md" } as TFile;
  const schema = {
    manifestPath: "schemas/test/manifest.md",
    rules: [],
    parseErrors: [],
    linkDependencies: [],
    inheritanceChain: ["schemas/test/manifest.md"],
    name: "test",
    priority: 0,
    target: {},
    fields: {},
    formatting: {},
  } as ResolvedSchema;
  const fieldDef = { type: "multilink", ...field } as ManifestField;
  return new PickerModal(app, "author", fieldDef, currentValue, schema, file, undefined, enableJs);
}

describe("PickerModal", () => {
  describe("selection overview", () => {
    const options: FieldOption[] = [
      { value: "inbox", label: "Inbox", group: "Status", type: "select" },
      { value: "working", label: "Working", group: "Status", type: "select" },
      { value: "done", label: "Done", group: "Status", type: "select" },
      { value: "topic", label: "Topic", group: "Topics", type: "multiselect" },
    ];

    it("shows selected values above the full list without removing or moving their rows", async () => {
      const modal = makeModal({ type: "multiselect", options }, ["working", "topic"]);
      await modal.onOpen();
      const chips = modal.contentEl.querySelectorAll(".mv-picker-selected-chip");
      expect(Array.from(chips, (chip) => chip.textContent)).toEqual(["Working", "Topic"]);
      const rows = modal.contentEl.querySelectorAll<HTMLElement>(".mv-picker-option");
      expect(Array.from(rows, (row) => row.dataset.value)).toEqual([
        "inbox",
        "working",
        "done",
        "topic",
      ]);
      expect(rows[1]?.getAttribute("aria-pressed")).toBe("true");
    });

    it("updates a select group in place and preserves scroll and keyboard focus", async () => {
      const modal = makeModal({ type: "multiselect", options }, ["working", "topic"]);
      document.body.appendChild(modal.contentEl);
      try {
        await modal.onOpen();
        const list = modal.contentEl.querySelector<HTMLElement>(".mv-picker-list")!;
        const rows = Array.from(list.querySelectorAll<HTMLButtonElement>(".mv-picker-option"));
        list.scrollTop = 120;
        rows[2]!.focus();
        rows[2]!.click();
        expect(list.scrollTop).toBe(120);
        expect(document.activeElement).toBe(rows[2]);
        expect(Array.from(list.querySelectorAll(".mv-picker-option"))).toEqual(rows);
        expect(rows[1]?.getAttribute("aria-pressed")).toBe("false");
        expect(rows[2]?.getAttribute("aria-pressed")).toBe("true");
        expect(rows[3]?.getAttribute("aria-pressed")).toBe("true");
        expect(
          Array.from(
            modal.contentEl.querySelectorAll(".mv-picker-selected-chip"),
            (chip) => chip.textContent
          )
        ).toEqual(["Done", "Topic"]);
      } finally {
        modal.contentEl.remove();
      }
    });

    it("keeps the selection overview visible while searching the full list", async () => {
      const modal = makeModal({ type: "multiselect", options }, ["done"]);
      await modal.onOpen();
      const search = modal.contentEl.querySelector<HTMLInputElement>(".mv-picker-search")!;
      search.value = "inbox";
      search.dispatchEvent(new Event("input"));
      expect(modal.contentEl.querySelector(".mv-picker-selected-chip")?.textContent).toBe("Done");
      expect(
        Array.from(
          modal.contentEl.querySelectorAll<HTMLElement>(".mv-picker-option"),
          (row) => row.dataset.value
        )
      ).toEqual(["inbox"]);
    });

    it("removes a selected shortcut without moving rows or losing keyboard focus", async () => {
      const modal = makeModal({ type: "multiselect", options }, ["working", "topic"]);
      document.body.appendChild(modal.contentEl);
      try {
        await modal.onOpen();
        const list = modal.contentEl.querySelector<HTMLElement>(".mv-picker-list")!;
        const rows = Array.from(list.querySelectorAll(".mv-picker-option"));
        const chip = modal.contentEl.querySelector<HTMLButtonElement>(".mv-picker-selected-chip")!;
        expect(chip.getAttribute("aria-label")).toBe("Remove Working");
        expect(chip.querySelector(".mv-picker-option-label")?.innerHTML).toBe(
          rows[1]?.querySelector(".mv-picker-option-label")?.innerHTML
        );
        list.scrollTop = 90;
        chip.focus();
        chip.click();
        expect(list.scrollTop).toBe(90);
        expect(Array.from(list.querySelectorAll(".mv-picker-option"))).toEqual(rows);
        expect(rows[1]?.getAttribute("aria-pressed")).toBe("false");
        expect(rows[3]?.getAttribute("aria-pressed")).toBe("true");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove Topic");
        expect(
          modal.contentEl.querySelector(".mv-picker-selected-values")?.getAttribute("aria-label")
        ).toBe("Selected values");
      } finally {
        modal.contentEl.remove();
      }
    });

    it("saves clearing a single value once when the picker closes", async () => {
      const modal = makeModal({ type: "select", options }, "working");
      const frontmatter = { author: "working" };
      const save = vi.fn(async (_file: TFile, edit: (fm: typeof frontmatter) => void) =>
        edit(frontmatter)
      );
      Object.assign(modal.app, { fileManager: { processFrontMatter: save } });
      await modal.onOpen();
      modal.contentEl.querySelector<HTMLButtonElement>(".mv-picker-selected-chip")!.click();
      expect(modal.contentEl.querySelectorAll(".mv-picker-option.is-selected")).toHaveLength(0);
      expect(modal.contentEl.querySelector(".mv-picker-selected-empty")?.textContent).toBe("None");
      expect(save).not.toHaveBeenCalled();
      modal.onClose();
      expect(frontmatter.author).toBeNull();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("removes an unavailable value from a non-strict field while preserving other unmanaged values", async () => {
      const modal = makeModal({ type: "multiselect", options, strict: false }, [
        "working",
        "legacy",
        "keep",
      ]);
      const frontmatter = { author: ["working", "legacy", "keep", "added-elsewhere"] };
      Object.assign(modal.app, {
        fileManager: {
          processFrontMatter: async (_file: TFile, edit: (fm: typeof frontmatter) => void) =>
            edit(frontmatter),
        },
      });
      await modal.onOpen();
      modal.contentEl
        .querySelector<HTMLButtonElement>('.mv-picker-selected-chip[data-value="legacy"]')!
        .click();
      modal.onClose();
      expect(frontmatter.author).toEqual(["working", "keep", "added-elsewhere"]);
    });
  });

  it("finds an option by its description without changing its stored value", () => {
    const modal = makeModal({ type: "select" }, null) as unknown as {
      groupedOptions: (options: FieldOption[], query: string) => { options: FieldOption[] }[];
    };
    const groups = modal.groupedOptions(
      [
        { value: "A", label: "Primary", description: "Original experiments." },
        { value: "B", label: "Secondary", description: "Synthesis of studies." },
      ],
      "experiments"
    );
    expect(groups.flatMap((group) => group.options)).toMatchObject([
      { value: "A", label: "Primary", description: "Original experiments." },
    ]);
  });
  describe("source state", () => {
    it("explains when a JavaScript option source is disabled", async () => {
      const m = makeModal({ options: { source: { js: `return ["expert"];` } } }, ["expert"], false);
      const modal = m as unknown as {
        loadOptions: () => Promise<{ options: FieldOption[]; status: string }>;
        sourceStatus: string;
        emptyMessage: string;
      };

      const result = await modal.loadOptions();
      modal.sourceStatus = result.status;

      expect(result).toMatchObject({ options: [], status: "disabled" });
      expect(modal.emptyMessage).toContain("Allow JavaScript execution");
    });

    it("keeps a genuinely empty static source as a normal empty result", async () => {
      const m = makeModal({}, null);
      const modal = m as unknown as {
        loadOptions: () => Promise<{ options: FieldOption[]; status: string }>;
        sourceStatus: string;
        emptyMessage: string;
      };

      const result = await modal.loadOptions();
      modal.sourceStatus = result.status;

      expect(result).toEqual({ options: [], status: "resolved" });
      expect(modal.emptyMessage).toBe("No options available.");
    });
  });

  describe("normalise", () => {
    it("strips [[ and ]] from wikilinks", () => {
      const m = makeModal({}, null);
      expect((m as unknown as { normalise: (v: unknown) => string }).normalise("[[man]]")).toBe(
        "man"
      );
    });

    it("returns empty string for null/undefined", () => {
      const m = makeModal({}, null);
      const normalise = (m as unknown as { normalise: (v: unknown) => string }).normalise.bind(m);
      expect(normalise(null)).toBe("");
      expect(normalise(undefined)).toBe("");
    });

    it("returns empty string for empty string", () => {
      const m = makeModal({}, null);
      const normalise = (m as unknown as { normalise: (v: unknown) => string }).normalise.bind(m);
      expect(normalise("")).toBe("");
    });

    it("trims whitespace", () => {
      const m = makeModal({}, null);
      const normalise = (m as unknown as { normalise: (v: unknown) => string }).normalise.bind(m);
      expect(normalise("  hello  ")).toBe("hello");
    });

    it("strips only outer [[ and ]]", () => {
      const m = makeModal({}, null);
      const normalise = (m as unknown as { normalise: (v: unknown) => string }).normalise.bind(m);
      expect(normalise("[[note with [[nested]]]]")).toBe("note with [[nested]]");
    });
  });

  describe("initSelected + selected Set", () => {
    it("initialises from array of wikilinks", () => {
      const m = makeModal({ type: "multilink" }, ["[[man]]", "[[woman]]"]);
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.has("man")).toBe(true);
      expect(sel.has("woman")).toBe(true);
      expect(sel.size).toBe(2);
    });

    it("initialises from single value", () => {
      const m = makeModal({ type: "link" }, "[[book]]");
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.has("book")).toBe(true);
      expect(sel.size).toBe(1);
    });

    it("initialises empty for null", () => {
      const m = makeModal({}, null);
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.size).toBe(0);
    });

    it("initialises empty for undefined", () => {
      const m = makeModal({}, undefined);
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.size).toBe(0);
    });

    it("initialises from plain string without wikilink syntax", () => {
      const m = makeModal({ type: "select" }, "fiction");
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.has("fiction")).toBe(true);
      expect(sel.size).toBe(1);
    });

    it("initialises from array of plain strings", () => {
      const m = makeModal({ type: "multiselect" }, ["sci-fi", "fantasy"]);
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.has("sci-fi")).toBe(true);
      expect(sel.has("fantasy")).toBe(true);
      expect(sel.size).toBe(2);
    });

    it("deduplicates array entries", () => {
      const m = makeModal({ type: "multiselect" }, ["dup", "dup"]);
      const sel = (m as unknown as { selected: Set<string> }).selected;
      expect(sel.size).toBe(1);
    });
  });

  describe("filteredOptions", () => {
    it("keeps the selected item at its original position", () => {
      const m = makeModal({ type: "select" }, "banana");
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }, { value: "cherry" }];
      const result = filteredOptions(opts, "");
      expect(result.map((option) => option.value)).toEqual(["apple", "banana", "cherry"]);
    });

    it("preserves source order instead of sorting alphabetically", () => {
      const m = makeModal({ type: "select" }, "banana");
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "cherry" }, { value: "apple" }, { value: "banana" }];
      const result = filteredOptions(opts, "");
      expect(result.map((option) => option.value)).toEqual(["cherry", "apple", "banana"]);
    });

    it("filters by search query", () => {
      const m = makeModal({ type: "select" }, null);
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }];
      const result = filteredOptions(opts, "app");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("apple");
    });

    it("filters case-insensitively", () => {
      const m = makeModal({ type: "select" }, null);
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "Apple" }, { value: "Banana" }];
      const result = filteredOptions(opts, "APP");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("Apple");
    });

    it("returns empty array when no options match query", () => {
      const m = makeModal({ type: "select" }, null);
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }];
      const result = filteredOptions(opts, "xyz");
      expect(result).toHaveLength(0);
    });

    it("filters by label when label does not match value", () => {
      const m = makeModal({ type: "select" }, null);
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (
            opts: Array<{ value: string; label?: string }>,
            q: string
          ) => Array<{ value: string; label?: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "jrr-tolkien", label: "Tolkien" }];
      const result = filteredOptions(opts, "tolkien");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("jrr-tolkien");
    });

    it("preserves the complete order with multiple selected items", () => {
      const m = makeModal({ type: "multiselect" }, ["cherry", "apple"]);
      const filteredOptions = (
        m as unknown as {
          filteredOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).filteredOptions.bind(m);
      const opts = [{ value: "banana" }, { value: "apple" }, { value: "cherry" }];
      const result = filteredOptions(opts, "");
      expect(result.map((o) => o.value)).toEqual(["banana", "apple", "cherry"]);
    });
  });

  describe("grouped options", () => {
    it("groups options and preserves group-level selection mode", () => {
      const m = makeModal({ type: "multiselect" }, ["published"]);
      const groupedOptions = (
        m as unknown as {
          groupedOptions: (
            opts: FieldOption[],
            q: string
          ) => Array<{
            label: string;
            type: "select" | "multiselect";
            options: FieldOption[];
          }>;
        }
      ).groupedOptions.bind(m);

      const result = groupedOptions(
        [
          { value: "draft", label: "Draft", group: "Status", type: "select" },
          { value: "published", label: "Published", group: "Status", type: "select" },
          { value: "dev", label: "Dev", group: "Category", type: "multiselect" },
        ],
        ""
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.label).toBe("Status");
      expect(result[0]?.type).toBe("select");
      expect(result[0]?.options.map((option) => option.value)).toEqual(["draft", "published"]);
      expect(result[1]?.label).toBe("Category");
      expect(result[1]?.type).toBe("multiselect");
    });

    it("enforces single selection inside select groups", () => {
      const m = makeModal({ type: "multiselect" }, []);
      const modal = m as unknown as {
        options: FieldOption[];
        selected: Set<string>;
        toggleOption: (opt: FieldOption) => void;
      };

      modal.options = [
        { value: "draft", label: "Draft", group: "Status", type: "select" },
        { value: "published", label: "Published", group: "Status", type: "select" },
        { value: "dev", label: "Dev", group: "Category", type: "multiselect" },
      ];

      modal.toggleOption(modal.options[0]!);
      expect(modal.selected.has("draft")).toBe(true);

      modal.toggleOption(modal.options[1]!);
      expect(modal.selected.has("draft")).toBe(false);
      expect(modal.selected.has("published")).toBe(true);

      modal.toggleOption(modal.options[2]!);
      expect(modal.selected.has("published")).toBe(true);
      expect(modal.selected.has("dev")).toBe(true);
    });
  });
});
