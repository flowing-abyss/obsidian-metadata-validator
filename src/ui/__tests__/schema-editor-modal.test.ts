import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import type { ManifestCache } from "../../manifest/cache";
import type { Manifest, ManifestData } from "../../types";
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
