import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSchema } from "../../types";
import { ValidationEngine } from "../engine";

function makeApp(): App {
  return {
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {
      processFrontMatter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as App;
}

const SCHEMA: ResolvedSchema = {
  manifestPath: "schemas/book/manifest.md",
  name: "book",
  priority: 0,
  target: { query: '"Books/"' },
  fields: {
    status: {
      type: "select",
      required: true,
      options: [{ value: "to-read" }, { value: "reading" }, { value: "done" }],
    },
    rating: { type: "number", min: 1, max: 5 },
    icon: { type: "text", fixed: "📚" },
  },
  formatting: {},
  inheritanceChain: ["schemas/book/manifest.md"],
};

function makeAppWithFiles(files: Array<{ path: string; basename: string }>): App {
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (linkpath: string) =>
        files.find((f) => f.basename === linkpath) ?? null,
    },
    fileManager: {
      processFrontMatter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as App;
}

const DATE_SCHEMA: ResolvedSchema = {
  manifestPath: "schemas/event/manifest.md",
  name: "event",
  priority: 0,
  target: { query: '"Events/"' },
  fields: {
    date: { type: "date", format: "YYYY-MM-DD" },
  },
  formatting: {},
  inheritanceChain: ["schemas/event/manifest.md"],
};

const LINK_SCHEMA: ResolvedSchema = {
  manifestPath: "schemas/book/manifest.md",
  name: "book",
  priority: 0,
  target: { query: '"Books/"' },
  fields: {
    author: {
      type: "link",
      source: { folder: "People/" },
      validate_exists: true,
    },
  },
  formatting: {},
  inheritanceChain: ["schemas/book/manifest.md"],
};

const JS_SCHEMA: ResolvedSchema = {
  manifestPath: "schemas/custom/manifest.md",
  name: "custom",
  priority: 0,
  target: {},
  fields: {
    value: {
      type: "text",
      validate: { js: "return value === 'ok';" },
    },
  },
  formatting: {},
  inheritanceChain: ["schemas/custom/manifest.md"],
};

describe("ValidationEngine", () => {
  it("auto-inserts null for required field that is absent (no error shown)", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: false });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    // Required field without default → auto-inserted as null (autoFixed), not an error
    const autoFixed = results.find((r) => r.autoFixed && r.field === "status");
    expect(autoFixed).toBeDefined();
    expect(frontmatter["status"]).toBeNull();
    // No "required" error
    const req = results.find((r) => r.rule === "required");
    expect(req).toBeUndefined();
  });

  it("returns error for value not in options", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "draft", rating: 3 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const opt = results.find((r) => r.rule === "options");
    expect(opt?.field).toBe("status");
  });

  it("applies auto-fix for fixed field and marks autoFixed", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = {
      status: "reading",
      rating: 3,
    };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    expect(frontmatter["icon"]).toBe("📚");

    const fixed = results.find((r) => r.autoFixed && r.field === "icon");
    expect(fixed).toBeDefined();
  });

  it("returns no errors for fully valid frontmatter", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "reading", rating: 4, icon: "📚" };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const errors = results.filter((r) => !r.autoFixed);
    expect(errors).toHaveLength(0);
  });

  it("skips options validation when field was auto-fixed from empty", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        status: {
          type: "select",
          required: true,
          default: "to-read",
          options: [{ value: "to-read" }, { value: "reading" }],
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = {};

    const results = await engine.validate(file, frontmatter, schema);
    const opt = results.find((r) => r.rule === "options");
    expect(opt).toBeUndefined();
  });

  it("validates date format when field type is date", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Events/A.md", basename: "A" } as TFile;
    const frontmatter = { date: "not-a-date" };

    const results = await engine.validate(file, frontmatter, DATE_SCHEMA);
    const dateErr = results.find((r) => r.rule === "date-format");
    expect(dateErr).toBeDefined();
    expect(dateErr?.field).toBe("date");
  });

  it("validates link source and existence for link fields", async () => {
    const app = makeAppWithFiles([{ path: "People/Alice.md", basename: "Alice" }]);
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { author: "Bob" };

    const results = await engine.validate(file, frontmatter, LINK_SCHEMA);
    const linkSrc = results.find((r) => r.rule === "link-source");
    const linkEx = results.find((r) => r.rule === "link-exists");
    expect(linkSrc).toBeDefined();
    expect(linkEx).toBeDefined();
  });

  it("accepts valid link values", async () => {
    const app = makeAppWithFiles([{ path: "People/Alice.md", basename: "Alice" }]);
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { author: "Alice" };

    const results = await engine.validate(file, frontmatter, LINK_SCHEMA);
    const errors = results.filter((r) => !r.autoFixed);
    expect(errors).toHaveLength(0);
  });

  it("runs JS validator when field.validate.js is set", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Custom/A.md", basename: "A" } as TFile;
    const frontmatter = { value: "bad" };

    const results = await engine.validate(file, frontmatter, JS_SCHEMA);
    const jsErr = results.find((r) => r.rule === "js-validator");
    expect(jsErr).toBeDefined();
    expect(jsErr?.field).toBe("value");
  });

  it("passes JS validator when value is valid", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Custom/A.md", basename: "A" } as TFile;
    const frontmatter = { value: "ok" };

    const results = await engine.validate(file, frontmatter, JS_SCHEMA);
    const jsErr = results.find((r) => r.rule === "js-validator");
    expect(jsErr).toBeUndefined();
  });

  it("skips dynamic options validation when strict is false", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        status: {
          type: "select",
          options: { source: { folder: "Statuses/" } },
          strict: false,
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "whatever" };

    const results = await engine.validate(file, frontmatter, schema);
    const opt = results.find((r) => r.rule === "options");
    expect(opt).toBeUndefined();
  });

  it("validates dynamic options when strict is true (default)", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        status: {
          type: "select",
          options: { source: { folder: "Statuses/" } },
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "whatever" };

    const results = await engine.validate(file, frontmatter, schema);
    const opt = results.find((r) => r.rule === "options");
    expect(opt).toBeDefined();
  });

  it("does not treat a disabled JS source as an empty allow-list", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        tags: {
          type: "multiselect",
          options: { source: { js: `return ["expert"];` } },
        },
        author: {
          type: "link",
          source: { js: `return ["Alice"];` },
          validate_exists: false,
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: false });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { tags: ["expert"], author: "[[Alice]]" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await engine.validate(file, frontmatter, schema);

    expect(results.find((r) => r.rule === "options")).toBeUndefined();
    expect(results.find((r) => r.rule === "link-source")).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("handles dynamic options object without source property", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        status: {
          type: "select",
          options: {} as { source: { folder: string } },
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "whatever" };

    const results = await engine.validate(file, frontmatter, schema);
    const opt = results.find((r) => r.rule === "options");
    expect(opt).toBeUndefined();
  });

  it("applies property ordering and reports autoFixed", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        z: { type: "text" },
        a: { type: "text" },
      },
      formatting: { property_order: ["a", "z"] },
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { z: 1, a: 2 };

    const results = await engine.validate(file, frontmatter, schema);
    const order = results.find((r) => r.rule === "property-order");
    expect(order).toBeDefined();
    expect(order?.autoFixed).toBe(true);
    expect(Object.keys(frontmatter)).toEqual(["a", "z"]);
  });

  it("does not report property order when already correct", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        z: { type: "text" },
        a: { type: "text" },
      },
      formatting: { property_order: ["a", "z"] },
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { a: 1, z: 2 };

    const results = await engine.validate(file, frontmatter, schema);
    const order = results.find((r) => r.rule === "property-order");
    expect(order).toBeUndefined();
  });

  it("does not report property order when schema has no fields", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {},
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { a: 1 };

    const results = await engine.validate(file, frontmatter, schema);
    const order = results.find((r) => r.rule === "property-order");
    expect(order).toBeUndefined();
  });

  it("skips options validation when empty array was auto-fixed to default", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        status: {
          type: "select",
          default: "to-read",
          options: [{ value: "to-read" }],
        },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter: Record<string, unknown> = { status: [] };

    const results = await engine.validate(file, frontmatter, schema);
    const opt = results.find((r) => r.rule === "options");
    expect(opt).toBeUndefined();
    const fixed = results.find((r) => r.autoFixed && r.field === "status");
    expect(fixed).toBeDefined();
  });

  it("does not validate number range when min and max are absent", async () => {
    const schema: ResolvedSchema = {
      manifestPath: "schemas/book/manifest.md",
      name: "book",
      priority: 0,
      target: {},
      fields: {
        count: { type: "number" },
      },
      formatting: {},
      inheritanceChain: ["schemas/book/manifest.md"],
    };
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { count: 999 };

    const results = await engine.validate(file, frontmatter, schema);
    const range = results.find((r) => r.rule === "number-range");
    expect(range).toBeUndefined();
  });

  it("returns no date error for valid date", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Events/A.md", basename: "A" } as TFile;
    const frontmatter = { date: "2024-03-15" };

    const results = await engine.validate(file, frontmatter, DATE_SCHEMA);
    const dateErr = results.find((r) => r.rule === "date-format");
    expect(dateErr).toBeUndefined();
  });

  it("returns error when number is outside min/max range", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: true });
    const file = { path: "Books/A.md", basename: "A" } as TFile;
    const frontmatter = { status: "reading", rating: 10 };

    const results = await engine.validate(file, frontmatter, SCHEMA);
    const range = results.find((r) => r.rule === "number-range");
    expect(range).toBeDefined();
    expect(range?.field).toBe("rating");
  });

  it("skips JS validator when enableJsExecution is false", async () => {
    const app = makeApp();
    const engine = new ValidationEngine(app, { enableJsExecution: false });
    const file = { path: "Custom/A.md", basename: "A" } as TFile;
    const frontmatter = { value: "bad" };

    const results = await engine.validate(file, frontmatter, JS_SCHEMA);
    const jsResult = results.find((r) => r.rule === "js-validator");
    expect(jsResult).toBeDefined();
    expect(jsResult?.severity).toBe("warning");
    expect(jsResult?.message).toContain("JS validation disabled");
  });
});
