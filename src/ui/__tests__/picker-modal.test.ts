import { describe, it, expect } from "vitest";
import { PickerModal } from "../picker-modal";
import type { App, TFile } from "obsidian";
import type { ManifestField, ResolvedSchema } from "../../types";

function makeModal(field: Partial<ManifestField>, currentValue: unknown) {
  const app = {} as App;
  const file = { path: "test.md", basename: "test", extension: "md" } as TFile;
  const schema = {
    manifestPath: "schemas/test/manifest.md",
    inheritanceChain: ["schemas/test/manifest.md"],
    name: "test",
    priority: 0,
    target: {},
    fields: {},
    formatting: {},
  } as ResolvedSchema;
  const fieldDef = { type: "multilink", ...field } as ManifestField;
  return new PickerModal(app, "author", fieldDef, currentValue, schema, file);
}

describe("PickerModal", () => {
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

  describe("sortedOptions", () => {
    it("puts selected items first", () => {
      const m = makeModal({ type: "select" }, "banana");
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }, { value: "cherry" }];
      const result = sortedOptions(opts, "");
      expect(result[0]!.value).toBe("banana"); // selected first
    });

    it("sorts unselected alphabetically", () => {
      const m = makeModal({ type: "select" }, "banana");
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "cherry" }, { value: "apple" }, { value: "banana" }];
      const result = sortedOptions(opts, "");
      expect(result[0]!.value).toBe("banana"); // selected
      expect(result[1]!.value).toBe("apple"); // alphabetical
      expect(result[2]!.value).toBe("cherry");
    });

    it("filters by search query", () => {
      const m = makeModal({ type: "select" }, null);
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }];
      const result = sortedOptions(opts, "app");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("apple");
    });

    it("filters case-insensitively", () => {
      const m = makeModal({ type: "select" }, null);
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "Apple" }, { value: "Banana" }];
      const result = sortedOptions(opts, "APP");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("Apple");
    });

    it("returns empty array when no options match query", () => {
      const m = makeModal({ type: "select" }, null);
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "apple" }, { value: "banana" }];
      const result = sortedOptions(opts, "xyz");
      expect(result).toHaveLength(0);
    });

    it("filters by label when label does not match value", () => {
      const m = makeModal({ type: "select" }, null);
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (
            opts: Array<{ value: string; label?: string }>,
            q: string
          ) => Array<{ value: string; label?: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "jrr-tolkien", label: "Tolkien" }];
      const result = sortedOptions(opts, "tolkien");
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("jrr-tolkien");
    });

    it("multiple selected items preserve their relative order (insertion order)", () => {
      const m = makeModal({ type: "multiselect" }, ["cherry", "apple"]);
      const sortedOptions = (
        m as unknown as {
          sortedOptions: (opts: Array<{ value: string }>, q: string) => Array<{ value: string }>;
        }
      ).sortedOptions.bind(m);
      const opts = [{ value: "banana" }, { value: "apple" }, { value: "cherry" }];
      const result = sortedOptions(opts, "");
      // cherry and apple are selected; banana is unselected
      const values = result.map((o) => o.value);
      expect(values.indexOf("cherry")).toBeLessThan(values.indexOf("banana"));
      expect(values.indexOf("apple")).toBeLessThan(values.indexOf("banana"));
    });
  });
});
