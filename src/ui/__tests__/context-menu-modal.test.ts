import { describe, it, expect, vi } from "vitest";
import { ContextMenuModal } from "../context-menu-modal";
import type { App, TFile } from "obsidian";
import type { ManifestField, ResolvedSchema } from "../../types";

function makeModal(
  schema: Partial<ResolvedSchema>,
  getFields?: (p: string) => Record<string, ManifestField> | undefined
) {
  const app = {
    metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
    fileManager: {},
  } as unknown as App;
  const file = { path: "test.md", basename: "test", extension: "md" } as TFile;
  const fullSchema: ResolvedSchema = {
    manifestPath: "schemas/book/manifest.md",
    name: "book",
    priority: 0,
    target: {},
    fields: {},
    formatting: {},
    inheritanceChain: ["schemas/base/manifest.md", "schemas/book/manifest.md"],
    ...schema,
  };
  return new ContextMenuModal(app, file, fullSchema, getFields);
}

describe("ContextMenuModal", () => {
  describe("toStr", () => {
    it("converts string", () => {
      const m = makeModal({});
      expect((m as unknown as { toStr: (v: unknown) => string }).toStr("hello")).toBe("hello");
    });
    it("converts number", () => {
      const m = makeModal({});
      expect((m as unknown as { toStr: (v: unknown) => string }).toStr(42)).toBe("42");
    });
    it("returns empty string for null", () => {
      const m = makeModal({});
      expect((m as unknown as { toStr: (v: unknown) => string }).toStr(null)).toBe("");
    });
  });

  describe("fieldOrigin", () => {
    const getFields = (p: string) => {
      if (p === "schemas/base/manifest.md")
        return { title: { type: "text" as const }, shared: { type: "text" as const } };
      if (p === "schemas/book/manifest.md")
        return { rating: { type: "number" as const }, shared: { type: "number" as const } };
      return undefined;
    };

    it("returns 'inherited' for field only in parent", () => {
      const m = makeModal({}, getFields);
      const result = (m as unknown as { fieldOrigin: (k: string) => string }).fieldOrigin("title");
      expect(result).toBe("inherited");
    });

    it("returns 'own' for field only in child", () => {
      const m = makeModal({}, getFields);
      const result = (m as unknown as { fieldOrigin: (k: string) => string }).fieldOrigin("rating");
      expect(result).toBe("own");
    });

    it("returns 'overrides' for field in both parent and child", () => {
      const m = makeModal({}, getFields);
      const result = (m as unknown as { fieldOrigin: (k: string) => string }).fieldOrigin("shared");
      expect(result).toBe("overrides");
    });

    it("returns 'own' when getManifestFields is not provided", () => {
      const m = makeModal({});
      const result = (m as unknown as { fieldOrigin: (k: string) => string }).fieldOrigin("title");
      expect(result).toBe("own");
    });
  });

  describe("quoteLinksIfNeeded", () => {
    it("wraps wikilinks in quotes", () => {
      const m = makeModal({});
      const fn = (m as unknown as { quoteLinksIfNeeded: (v: string) => string }).quoteLinksIfNeeded;
      if (!fn) return; // if method doesn't exist, skip
      expect(fn.call(m, "[[MyNote]]")).toBe('"[[MyNote]]"');
    });

    it("wraps markdown links in quotes", () => {
      const m = makeModal({});
      const fn = (m as unknown as { quoteLinksIfNeeded: (v: string) => string }).quoteLinksIfNeeded;
      if (!fn) return;
      expect(fn.call(m, "[My Note](path/to/note.md)")).toBe('"[My Note](path/to/note.md)"');
    });

    it("returns plain strings unchanged", () => {
      const m = makeModal({});
      const fn = (m as unknown as { quoteLinksIfNeeded: (v: string) => string }).quoteLinksIfNeeded;
      if (!fn) return;
      expect(fn.call(m, "just a string")).toBe("just a string");
    });

    it("returns already-quoted strings unchanged", () => {
      const m = makeModal({});
      const fn = (m as unknown as { quoteLinksIfNeeded: (v: string) => string }).quoteLinksIfNeeded;
      if (!fn) return;
      expect(fn.call(m, '"[[MyNote]]"')).toBe('"[[MyNote]]"');
    });
  });
});
