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
    rules: [],
    parseErrors: [],
    linkDependencies: [],
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
      expect(m.fieldOrigin("title")).toBe("inherited");
    });

    it("returns 'own' for field only in child", () => {
      const m = makeModal({}, getFields);
      expect(m.fieldOrigin("rating")).toBe("own");
    });

    it("returns 'overrides' for field in both parent and child", () => {
      const m = makeModal({}, getFields);
      expect(m.fieldOrigin("shared")).toBe("overrides");
    });

    it("returns 'own' when getManifestFields is not provided", () => {
      const m = makeModal({});
      expect(m.fieldOrigin("title")).toBe("own");
    });
  });

  describe("renderFooter rules line", () => {
    function footerOf(schema: Partial<ResolvedSchema>): HTMLElement {
      const m = makeModal(schema);
      const container = document.createElement("div");
      (
        m as unknown as {
          renderFooter: (el: HTMLElement, map: Map<string, unknown[]>) => void;
        }
      ).renderFooter(container, new Map());
      return container;
    }

    it("lists rules under the schema, named or by their when text", () => {
      const footer = footerOf({
        rules: [
          { name: "end on done", description: "Sets end when done.", then: {} },
          { when: "status=🟦 AND start=", then: {} },
          { then: {} },
        ],
      });
      const line = footer.querySelector(".mv-footer-rules")!;
      expect(line.textContent).toBe("Rules: end on done • status=🟦 AND start= • #3");
      expect(footer.querySelector(".mv-footer-filepath")).not.toBeNull();
    });

    it("renders nothing when the schema has no rules", () => {
      expect(footerOf({ rules: [] }).querySelector(".mv-footer-rules")).toBeNull();
      expect(
        footerOf({ rules: [], inheritanceChain: ["schemas/book/manifest.md"] }).querySelector(
          ".mv-footer-rules"
        )
      ).toBeNull();
    });

    it("lists rules in the single-schema footer too", () => {
      const footer = footerOf({
        inheritanceChain: ["schemas/book/manifest.md"],
        rules: [{ name: "only", then: {} }],
      });
      expect(footer.querySelector(".mv-footer-rules")?.textContent).toBe("Rules: only");
    });
  });
});
