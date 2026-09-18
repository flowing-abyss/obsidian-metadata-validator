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
  rules: [],
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
  rules: [],
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
  rules: [],
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
  rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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
      rules: [],
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

describe("ValidationEngine rules", () => {
  const NOW = () => new Date("2026-09-18T12:00:00+07:00");

  function makeVaultApp(files: Record<string, Record<string, unknown>>): App {
    const tfiles = Object.keys(files).map(
      (p) =>
        ({ path: p, basename: (p.split("/").pop() ?? p).replace(/\.md$/, ""), extension: "md" }) as TFile
    );
    return {
      vault: { getMarkdownFiles: () => tfiles },
      metadataCache: {
        getFileCache: (f: TFile) => (files[f.path] ? { frontmatter: files[f.path], tags: [] } : null),
        getFirstLinkpathDest: (name: string) => tfiles.find((f) => f.basename === name) ?? null,
      },
      fileManager: { processFrontMatter: vi.fn().mockResolvedValue(undefined) },
    } as unknown as App;
  }

  function schemaWith(
    fields: ResolvedSchema["fields"],
    rules: ResolvedSchema["rules"],
    formatting: ResolvedSchema["formatting"] = {}
  ): ResolvedSchema {
    return {
      manifestPath: "schemas/project/manifest.md",
      name: "project",
      priority: 0,
      target: { query: "#project" },
      fields,
      rules,
      formatting,
      inheritanceChain: ["schemas/project/manifest.md"],
    };
  }

  const file = { path: "Projects/A.md", basename: "A", extension: "md" } as TFile;

  it("required sees the value a rule just set", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith(
      { status: { type: "select" }, end: { type: "date", required: true } },
      [{ name: "end on done", when: "status=🟩 AND end=", then: { set: { end: "{{today}}" } } }]
    );
    const fm: Record<string, unknown> = { status: "🟩" };
    const results = await engine.validate(file, fm, schema);
    expect(fm.end).toBe("2026-09-18");
    expect(results.find((r) => r.rule === "required")).toBeUndefined();
    expect(results.find((r) => r.rule === "rules")).toMatchObject({ field: "end", autoFixed: true });
  });

  it("default is visible to rules and rules can change it", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith(
      { status: { type: "select", default: "📥" }, priority: { type: "select" } },
      [{ when: "status=📥", then: { set: { priority: "◽" } } }]
    );
    const fm: Record<string, unknown> = {};
    await engine.validate(file, fm, schema);
    expect(fm.status).toBe("📥");
    expect(fm.priority).toBe("◽");
  });

  it("fixed wins over a js rule that overwrote it", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: true }, { now: NOW });
    const schema = schemaWith({ icon: { type: "text", fixed: "📚" } }, [
      { then: { js: "fm.icon = 'x'" } },
    ]);
    const fm: Record<string, unknown> = { icon: "📚" };
    const results = await engine.validate(file, fm, schema);
    expect(fm.icon).toBe("📚");
    expect(results.filter((r) => r.rule === "fixed")).toHaveLength(1);
  });

  it("sort applies after add", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith({ tags: { type: "multiselect", sort: "alphabetical" } }, [
      { then: { add: { tags: "a" } } },
    ]);
    const fm: Record<string, unknown> = { tags: ["c", "b"] };
    const results = await engine.validate(file, fm, schema);
    expect(fm.tags).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.rule)).toEqual(["sort", "rules", "sort"]);
  });

  it("list wrap applies after set on a list field", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith({ aliases: { type: "list" }, title: { type: "text" } }, [
      { when: "aliases=", then: { set: { aliases: "{{title}}" } } },
    ]);
    const fm: Record<string, unknown> = { title: "T" };
    await engine.validate(file, fm, schema);
    expect(fm.aliases).toEqual(["T"]);
  });

  it("options check is still skipped when a default filled an empty select", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith(
      { status: { type: "select", default: "x", options: [{ value: "a" }] } },
      [{ then: { set: { other: 1 } } }]
    );
    const fm: Record<string, unknown> = {};
    const results = await engine.validate(file, fm, schema);
    expect(results.find((r) => r.rule === "options")).toBeUndefined();
  });

  it("transfer between link fields with the property order applied", async () => {
    const app = makeVaultApp({
      "base/IP.md": { tags: ["system/high/problem"] },
      "base/M.md": { tags: ["system/high/meta"] },
    });
    const engine = new ValidationEngine(app, { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith(
      {
        meta: { type: "multilink", sort: "alphabetical", validate_exists: false },
        problem: { type: "multilink", sort: "alphabetical", validate_exists: false },
      },
      [
        {
          then: {
            add: {
              problem: { meta: { when: "#system/high/problem" } },
              meta: { problem: { when: "#system/high/meta" } },
            },
            remove: {
              meta: { when: "#system/high/problem" },
              problem: { when: "#system/high/meta" },
            },
          },
        },
      ],
      { property_order: ["problem", "meta"] }
    );
    const fm: Record<string, unknown> = { meta: ["[[IP]]", "[[M]]"], problem: [] };
    const results = await engine.validate(file, fm, schema);
    expect(fm.meta).toEqual(["[[M]]"]);
    expect(fm.problem).toEqual(["[[IP]]"]);
    expect(Object.keys(fm)).toEqual(["problem", "meta"]);
    expect(results.filter((r) => !r.autoFixed)).toEqual([]);
  });

  it("rule-config warnings surface as non-fixed warnings", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith({ status: { type: "select" } }, [{ then: { add: { status: "x" } } }]);
    const results = await engine.validate(file, { status: "a" }, schema);
    expect(results).toEqual([
      expect.objectContaining({ rule: "rule-config", severity: "warning", autoFixed: false }),
    ]);
  });

  it("a schema without rules skips phases 2 and 3", async () => {
    const engine = new ValidationEngine(makeApp(), { enableJsExecution: false }, { now: NOW });
    const schema = schemaWith({ tags: { type: "multiselect", sort: "alphabetical" } }, []);
    const fm: Record<string, unknown> = { tags: ["b", "a"] };
    const results = await engine.validate(file, fm, schema);
    expect(fm.tags).toEqual(["a", "b"]);
    expect(results.map((r) => r.rule)).toEqual(["sort"]);
  });
});
