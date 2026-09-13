import { describe, expect, it } from "vitest";
import type { FuzzyMatch } from "obsidian";
import type { KeyboardPropertyItem } from "../../types";
import { sectionSuggestions, matchKeyboardSuggestions } from "../keyboard-property-sections";

const match = (item: KeyboardPropertyItem): FuzzyMatch<KeyboardPropertyItem> => ({
  item,
  match: { score: 0, matches: [] },
});

describe("keyboard sections", () => {
  it("pins a selected option beyond the native suggestion limit", () => {
    const items: KeyboardPropertyItem[] = Array.from({ length: 500 }, (_, i) => ({
      kind: "option",
      label: String(i),
      option: { value: String(i) },
    }));
    const matched = matchKeyboardSuggestions(items, "", (item) => item.label);
    const grouped = sectionSuggestions(matched, new Set(["499"]));
    expect(grouped[0]?.item.label).toBe("499");
    expect(grouped.slice(1).map(({ item }) => item.label)).toEqual(items.map((item) => item.label));
  });

  it("groups required fields without changing order within each group or adding arrow stops", () => {
    const items = [false, true, false, true].map((required, index) =>
      match({
        kind: "property",
        label: String(index),
        property: { key: String(index), label: String(index), field: { type: "text", required } },
      })
    );
    const grouped = sectionSuggestions(items);
    expect(grouped.map(({ item }) => item.label)).toEqual(["1", "3", "0", "2"]);
    expect(grouped.map(({ item }) => item.section)).toEqual([
      "Required",
      undefined,
      "Other properties",
      undefined,
    ]);
    expect(grouped).toHaveLength(items.length);
  });
  it("duplicates selected choices above the entire ordered list and updates after removal", () => {
    const items = ["todo", "doing", "done"].map((value) =>
      match({ kind: "option", option: { value }, label: value })
    );
    const grouped = sectionSuggestions(items, new Set(["done"]));
    expect(grouped.map(({ item }) => item.label)).toEqual(["done", "todo", "doing", "done"]);
    expect(grouped[0]?.item).toMatchObject({ pinned: true, section: "Selected" });
    expect(grouped[1]?.item.section).toBe("All values");
    expect(sectionSuggestions(items, new Set())).toEqual(items);
  });
  it("does not reintroduce filtered-out choices or empty sections", () => {
    const items = [match({ kind: "option", option: { value: "todo" }, label: "To do" })];
    expect(sectionSuggestions(items, new Set(["done"]))).toEqual(items);
    expect(sectionSuggestions([])).toEqual([]);
  });
});
