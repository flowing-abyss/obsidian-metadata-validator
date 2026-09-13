import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { ManifestField } from "../../types";
import { KeyboardPropertyDraft } from "../keyboard-property-draft";
function setup(field: ManifestField, value: unknown) {
  const fm: Record<string, unknown> = { property: value, other: "keep" };
  const write = vi.fn(async (_file: TFile, edit: (fm: Record<string, unknown>) => void) =>
    edit(fm)
  );
  const app = {
    metadataCache: { getFirstLinkpathDest: () => null },
    fileManager: { processFrontMatter: write },
  } as unknown as App;
  const draft = new KeyboardPropertyDraft(
    app,
    { path: "example.md" } as TFile,
    { key: "property", label: "Property", field },
    value
  );
  return { draft, fm, write, app };
}
describe("keyboard property drafts", () => {
  it.each([
    [{ type: "text" }, " New ", "New"],
    [{ type: "number" }, "0", 0],
    [{ type: "date" }, "2026-09-13", "2026-09-13"],
    [{ type: "link" }, "Note", "[[Note]]"],
  ] as [ManifestField, string, unknown][])(
    "saves %j without touching other properties",
    async (field, text, expected) => {
      const { draft, fm } = setup(field, null);
      await draft.save(text);
      expect(fm).toEqual({ property: expected, other: "keep" });
    }
  );
  it("rejects impossible dates and respects a custom date format", async () => {
    const { draft, write, fm } = setup({ type: "date", format: "DD/MM/YYYY" }, null);
    await expect(draft.save("29/02/2027")).rejects.toThrow("valid date");
    await expect(draft.save("2028-02-29")).rejects.toThrow("DD/MM/YYYY");
    expect(write).not.toHaveBeenCalled();
    await draft.save("29/02/2028");
    expect(fm.property).toBe("29/02/2028");
  });
  it("rejects invalid numbers without writing", async () => {
    const { draft, write } = setup({ type: "number" }, 5);
    await expect(draft.save("oops")).rejects.toThrow("valid number");
    expect(write).not.toHaveBeenCalled();
  });
  it("stores false as a boolean", async () => {
    const { draft, fm } = setup({ type: "boolean" }, true);
    draft.toggle({ value: "false" });
    await draft.save();
    expect(fm.property).toBe(false);
  });
  it("preserves unrelated selections and unmanaged values when changing a single-choice group", async () => {
    const { draft, fm } = setup({ type: "multiselect", strict: false, options: [] }, [
      "old",
      "topic",
      "legacy",
      "keep",
    ]);
    draft.options = [
      { value: "old", group: "Status", type: "select" },
      { value: "new", group: "Status", type: "select" },
      { value: "topic", type: "multiselect" },
    ];
    draft.toggle(draft.options[1]!);
    draft.toggle({ value: "legacy" });
    await draft.save();
    expect(fm.property).toEqual(["topic", "new", "keep"]);
  });
  it("retains required empty properties and removes optional empty properties", async () => {
    for (const required of [true, false]) {
      const { draft, fm } = setup({ type: "text", required }, "Old");
      await draft.save("");
      expect("property" in fm).toBe(required);
    }
  });
});

describe("keyboard draft write safeguards", () => {
  it.each([false, 0, null, "Locked"])("rejects a fixed value of %j", async (fixed) => {
    const { draft, write } = setup({ type: "text", fixed }, fixed);
    await expect(draft.save("Changed")).rejects.toThrow("fixed value");
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps a failed write dirty so a user can retry without losing selections", async () => {
    const { draft, fm, write } = setup({ type: "multiselect", options: [] }, []);
    draft.toggle({ value: "added" });
    write.mockRejectedValueOnce(new Error("File unavailable"));
    await expect(draft.save()).rejects.toThrow("File unavailable");
    expect(draft.dirty).toBe(true);
    expect(draft.selected.has("added")).toBe(true);
    await draft.save();
    expect(fm.property).toEqual(["added"]);
    expect(draft.dirty).toBe(false);
  });

  it("stores numeric choices as numbers and rejects invalid numeric options", async () => {
    const { draft, fm, write } = setup({ type: "number", options: [] }, 1);
    draft.toggle({ value: "2" });
    await draft.save();
    expect(fm.property).toBe(2);
    draft.toggle({ value: "NaN" });
    await expect(draft.save()).rejects.toThrow("valid number");
    expect(write).toHaveBeenCalledTimes(1);
    expect(fm.property).toBe(2);
  });

  function linkSetup(field: ManifestField, value: unknown) {
    const result = setup(field, value);
    const files = new Map([
      ["A/Note", { path: "A/Note.md", basename: "Note" }],
      ["B/Note", { path: "B/Note.md", basename: "Note" }],
      ["Other", { path: "Other.md", basename: "Other" }],
    ]);
    result.app.metadataCache.getFirstLinkpathDest = vi.fn(
      (path) => (files.get(path === "Note" ? "A/Note" : path) as TFile | undefined) ?? null
    );
    result.app.fileManager.generateMarkdownLink = vi.fn(
      (file) => `[[${file.path.replace(/\.md$/, "")}]]`
    );
    return result;
  }

  it("preserves both full paths and aliases when adding to a free multilink list", async () => {
    const { draft, fm } = linkSetup({ type: "multilink" }, [
      "[[A/Note|First]]",
      "[[B/Note|Second]]",
    ]);
    expect(draft.selected.size).toBe(2);
    draft.add("Other");
    await draft.save();
    expect(fm.property).toEqual(["[[A/Note|First]]", "[[B/Note|Second]]", "[[Other]]"]);
  });

  it("matches source options by target identity without conflating duplicate basenames", async () => {
    const { draft, fm } = linkSetup({ type: "multilink", options: [] }, [
      "[[A/Note|First]]",
      "[[B/Note|Second]]",
    ]);
    draft.options = [{ value: "Note" }, { value: "Other" }];
    expect(Array.from(draft.selected)).toEqual(["Note", "B/Note"]);
    draft.toggle({ value: "Other" });
    await draft.save();
    expect(fm.property).toEqual(["[[A/Note|First]]", "[[B/Note|Second]]", "[[Other]]"]);
  });

  it("preserves and explicitly removes unmanaged full links in non-strict sources", async () => {
    const { draft, fm } = linkSetup({ type: "multilink", options: [], strict: false }, [
      "[[A/Note|First]]",
      "[[B/Note|Second]]",
    ]);
    draft.options = [{ value: "Note" }, { value: "Other" }];
    draft.toggle({ value: "Other" });
    await draft.save();
    expect(fm.property).toEqual(["[[A/Note|First]]", "[[Other]]", "[[B/Note|Second]]"]);
    draft.toggle({ value: "B/Note" });
    await draft.save();
    expect(fm.property).toEqual(["[[A/Note|First]]", "[[Other]]"]);
  });

  it("accepts wiki-link options and free entries without double wrapping or losing aliases", async () => {
    const { draft, fm } = linkSetup({ type: "multilink" }, []);
    draft.add("[[B/Note|Second]]");
    await draft.save();
    expect(fm.property).toEqual(["[[B/Note|Second]]"]);
    draft.toggle({ value: "[[Other]]" });
    await draft.save();
    expect(fm.property).toEqual(["[[B/Note|Second]]", "[[Other]]"]);
  });
});
