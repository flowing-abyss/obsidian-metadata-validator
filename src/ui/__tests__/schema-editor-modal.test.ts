import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import type { ManifestCache } from "../../manifest/cache";
import type { Manifest, ManifestData, ManifestField } from "../../types";
import { SchemaEditorModal } from "../schema-editor-modal";

function makeCache(manifests: Manifest[]): ManifestCache {
  return {
    getByFolder(folderPath: string) {
      return manifests.find((m) => m.folderPath === folderPath);
    },
    getAll() {
      return manifests;
    },
  } as unknown as ManifestCache;
}

function inheritedKeys(manifestPath: string, data: ManifestData, cache: ManifestCache): string[] {
  const modal = new SchemaEditorModal({} as App, manifestPath, data, async () => undefined, cache);
  return (modal as unknown as { getInheritedFieldKeys: () => string[] }).getInheritedFieldKeys();
}

describe("SchemaEditorModal inherited fields", () => {
  it("keeps field help when switching to a different field type", () => {
    const modal = new SchemaEditorModal(
      {} as App,
      "schemas/manifest.md",
      {
        fields: { status: { type: "select", description: "Work stage." } },
      },
      async () => undefined
    );
    const internal = modal as unknown as {
      data: ManifestData;
      renderFieldCard: (el: HTMLElement, key: string, field: ManifestField) => void;
      buildCleanData: () => ManifestData;
    };
    const el = document.createElement("div");
    internal.renderFieldCard(el, "status", internal.data.fields!.status!);
    const select = el.querySelector<HTMLSelectElement>("select")!;
    select.value = "text";
    select.dispatchEvent(new Event("change"));
    expect(internal.buildCleanData().fields?.status).toEqual({
      type: "text",
      description: "Work stage.",
    });
  });
  it("preserves descriptions through editing option labels and saving", () => {
    const modal = new SchemaEditorModal(
      {} as App,
      "schemas/manifest.md",
      {
        description: "A source.",
        fields: {
          status: {
            type: "select",
            description: "Work stage.",
            options: [{ value: "done", label: "Done", description: "Work is complete." }],
          },
        },
      },
      async () => undefined
    );
    const internal = modal as unknown as {
      renderOptionsFields: (
        el: HTMLElement,
        key: string,
        field: ManifestField,
        update: (patch: Partial<ManifestField>) => void
      ) => void;
      data: ManifestData;
      buildCleanData: () => ManifestData;
    };
    const el = document.createElement("div");
    // Render through the actual editor so changing a label exercises its option commit path.
    internal.renderOptionsFields(el, "status", internal.data.fields!.status!, (patch) =>
      Object.assign(internal.data.fields!.status!, patch)
    );
    const label = el.querySelector<HTMLInputElement>(".mv-option-label")!;
    label.value = "Finished";
    label.dispatchEvent(new Event("change"));
    const saved = internal.buildCleanData();
    expect(saved.description).toBe("A source.");
    expect(saved.fields?.status?.description).toBe("Work stage.");
    expect(saved.fields?.status?.options).toEqual([
      { value: "done", label: "Finished", description: "Work is complete." },
    ]);
  });
  it("collects inherited fields from the full ancestor chain", () => {
    const category: Manifest = {
      path: "schemas/category/manifest.md",
      folderPath: "schemas/category",
      data: { fields: { level0: { type: "text" } } },
    };
    const meta: Manifest = {
      path: "schemas/category/meta/manifest.md",
      folderPath: "schemas/category/meta",
      data: { fields: { level1: { type: "number" } } },
    };
    const problem: Manifest = {
      path: "schemas/category/meta/problem/manifest.md",
      folderPath: "schemas/category/meta/problem",
      data: { fields: { level2: { type: "date" } } },
    };
    const hierarchy: Manifest = {
      path: "schemas/category/meta/problem/hierarchy/manifest.md",
      folderPath: "schemas/category/meta/problem/hierarchy",
      data: { fields: { level3: { type: "boolean" } } },
    };

    const cache = makeCache([category, meta, problem, hierarchy]);
    expect(inheritedKeys(hierarchy.path, hierarchy.data, cache)).toEqual([
      "level0",
      "level1",
      "level2",
    ]);
  });

  it("respects excludes defined on intermediate ancestors", () => {
    const root: Manifest = {
      path: "schemas/root/manifest.md",
      folderPath: "schemas/root",
      data: { fields: { rootField: { type: "text" } } },
    };
    const middle: Manifest = {
      path: "schemas/root/middle/manifest.md",
      folderPath: "schemas/root/middle",
      data: {
        exclude: ["rootField"],
        fields: { middleField: { type: "number" } },
      },
    };
    const leaf: Manifest = {
      path: "schemas/root/middle/leaf/manifest.md",
      folderPath: "schemas/root/middle/leaf",
      data: { fields: { leafField: { type: "date" } } },
    };

    const cache = makeCache([root, middle, leaf]);
    expect(inheritedKeys(leaf.path, leaf.data, cache)).toEqual(["middleField"]);
  });

  it("supports extends pointing to manifest.md path", () => {
    const base: Manifest = {
      path: "schemas/base/manifest.md",
      folderPath: "schemas/base",
      data: { fields: { baseField: { type: "text" } } },
    };
    const child: Manifest = {
      path: "schemas/child/manifest.md",
      folderPath: "schemas/child",
      data: {
        extends: "schemas/base/manifest.md",
        fields: { childField: { type: "number" } },
      },
    };

    const cache = makeCache([base, child]);
    expect(inheritedKeys(child.path, child.data, cache)).toEqual(["baseField"]);
  });
});

describe("SchemaEditorModal rules", () => {
  function modalWith(data: ManifestData) {
    const modal = new SchemaEditorModal({} as App, "schemas/manifest.md", data, async () => undefined);
    return modal as unknown as {
      data: ManifestData;
      applyRulesYaml: (text: string) => string | null;
      buildCleanData: () => ManifestData;
      renderRules: (el: HTMLElement) => void;
    };
  }

  it("round-trips rules through buildCleanData", () => {
    const rules = [{ when: "status=🟩 AND end=", then: { set: { end: "{{today}}" } } }];
    const internal = modalWith({ name: "x", rules });
    expect(internal.buildCleanData().rules).toEqual(rules);
    expect(modalWith({ name: "x", rules: [] }).buildCleanData().rules).toBeUndefined();
  });

  it("parses YAML into rules and reports errors", () => {
    const internal = modalWith({});
    expect(internal.applyRulesYaml("- when: a=\n  then:\n    set:\n      a: 1\n")).toBeNull();
    expect(internal.data.rules).toEqual([{ when: "a=", then: { set: { a: 1 } } }]);
    expect(internal.applyRulesYaml("when: a=")).toBe("Rules must be a YAML list.");
    expect(internal.applyRulesYaml("   ")).toBeNull();
    expect(internal.data.rules).toBeUndefined();
    expect(internal.applyRulesYaml("- [")).toMatch(/^Invalid YAML/);
  });

  it("renders the textarea with existing rules and updates on input", () => {
    const internal = modalWith({ rules: [{ then: { set: { a: 1 } } }] });
    const el = document.createElement("div");
    internal.renderRules(el);
    const area = el.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(area.value).toContain("set:");
    area.value = "- then:\n    add:\n      tags: x\n";
    area.dispatchEvent(new Event("input"));
    expect(internal.data.rules).toEqual([{ then: { add: { tags: "x" } } }]);
    expect(el.querySelector(".mv-rules-error")?.textContent).toBe("");
    area.value = "nope";
    area.dispatchEvent(new Event("input"));
    expect(el.querySelector(".mv-rules-error")?.textContent).toBe("Rules must be a YAML list.");
  });
});
