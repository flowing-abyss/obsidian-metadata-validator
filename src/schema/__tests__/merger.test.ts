import { describe, it, expect } from "vitest";
import { mergeSchemas } from "../merger";
import type { ManifestData } from "../../types";

describe("mergeSchemas", () => {
  it("child fields override parent fields", () => {
    const parent: ManifestData = {
      fields: {
        status: { type: "select", required: true, options: [{ value: "a" }] },
        title: { type: "text" },
      },
    };
    const child: ManifestData = {
      fields: {
        status: { type: "select", options: [{ value: "x" }, { value: "y" }] },
      },
    };

    const merged = mergeSchemas(parent, child);

    expect(merged.fields?.status?.options).toEqual([{ value: "x" }, { value: "y" }]);
    expect(merged.fields?.status?.required).toBeUndefined();
    expect(merged.fields?.title?.type).toBe("text");
  });

  it("child formatting overrides parent formatting", () => {
    const parent: ManifestData = {
      formatting: { property_order: ["a", "b", "c"] },
    };
    const child: ManifestData = {
      formatting: { property_order: ["x", "y"] },
    };

    const merged = mergeSchemas(parent, child);
    expect(merged.formatting?.property_order).toEqual(["x", "y"]);
  });

  it("inherits formatting when child has none", () => {
    const parent: ManifestData = {
      formatting: { property_order: ["a", "b"] },
    };
    const child: ManifestData = { fields: { rating: { type: "number" } } };

    const merged = mergeSchemas(parent, child);
    expect(merged.formatting?.property_order).toEqual(["a", "b"]);
  });

  it("child target does not inherit from parent", () => {
    const parent: ManifestData = { target: { folder: "Books/" } };
    const child: ManifestData = { target: { tag: "#movie" } };

    const merged = mergeSchemas(parent, child);
    expect(merged.target?.tag).toBe("#movie");
    expect(merged.target?.folder).toBeUndefined();
  });

  it("handles empty parent gracefully", () => {
    const child: ManifestData = { fields: { x: { type: "text" } } };
    const merged = mergeSchemas({}, child);
    expect(merged.fields?.x?.type).toBe("text");
  });
});
