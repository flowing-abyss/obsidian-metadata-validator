import { describe, expect, it } from "vitest";
import {
  expandTemplatesInQuery,
  hasTemplate,
  renderText,
  renderValue,
  TemplateError,
} from "../template";
import type { TemplateContext } from "../template";

const ctx: TemplateContext = {
  frontmatter: {
    category: ["[[data science]]", "[[Plans]]"],
    meta: "[[base/x|X]]",
    aliases: ["a", "b"],
    start: "2026-01-05",
    empty: null,
    count: 3,
  },
  file: { name: "Note", path: "base/Note.md", folder: "base" },
  now: () => new Date("2026-09-18T10:20:30+07:00"),
};

describe("template", () => {
  it("detects placeholders", () => {
    expect(hasTemplate("{{today}}")).toBe(true);
    expect(hasTemplate("x {{a|b}} y")).toBe(true);
    expect(hasTemplate("plain")).toBe(false);
  });

  it("renders today and now", () => {
    expect(renderValue("{{today}}", ctx)).toBe("2026-09-18");
    expect(String(renderValue("{{now}}", ctx))).toMatch(/^2026-09-18T\d{2}:\d{2}:\d{2}/);
  });

  it("uses the real clock when none is injected", () => {
    expect(String(renderValue("{{today}}", { ...ctx, now: undefined }))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it("renders file values", () => {
    expect(renderText("{{file.name}} in {{file.folder}} ({{file.path}})", ctx)).toBe(
      "Note in base (base/Note.md)"
    );
  });

  it("exact placeholder returns the raw value", () => {
    expect(renderValue("{{category}}", ctx)).toEqual(["[[data science]]", "[[Plans]]"]);
    expect(renderValue("{{meta}}", ctx)).toBe("[[base/x|X]]");
    expect(renderValue("{{count}}", ctx)).toBe(3);
    expect(renderValue("{{empty}}", ctx)).toBeNull();
    expect(renderValue("{{missing}}", ctx)).toBeNull();
  });

  it("embedded list placeholder expands into one string per element", () => {
    expect(renderText("category/{{category|name|snake}}", ctx)).toEqual([
      "category/data_science",
      "category/plans",
    ]);
  });

  it("rejects two list placeholders in one string", () => {
    expect(() => renderText("{{category}}-{{aliases}}", ctx)).toThrow(TemplateError);
  });

  it("applies filters left to right", () => {
    expect(renderText("{{meta|name|upper}}", ctx)).toBe("X");
    expect(renderText('{{aliases|join:", "}}', ctx)).toBe("a, b");
    expect(renderText("{{aliases|join}}", ctx)).toBe("a, b");
    expect(renderText("{{meta|name|join}}", ctx)).toBe("x");
    expect(renderText("{{empty|join}}", ctx)).toBeNull();
    expect(renderText('{{start|date:"DD.MM.YYYY"}}', ctx)).toBe("05.01.2026");
    expect(renderText("{{start|date}}", ctx)).toBe("2026-01-05");
    expect(renderText('{{meta|name|date:"YYYY"}}', ctx)).toBe("x");
    expect(renderText('{{meta|name|replace:"x","y"}}', ctx)).toBe("y");
    expect(renderText("{{meta|name|replace}}", ctx)).toBe("x");
    expect(renderText("{{meta|name|replace:'x','z'}}", ctx)).toBe("z");
    expect(renderText("{{meta|name|replace:x,q}}", ctx)).toBe("q");
    const spaced = { ...ctx, file: { ...ctx.file, name: " My Note " } };
    expect(renderText("{{file.name|kebab}}", spaced)).toBe("my-note");
    expect(renderText("{{file.name|snake}}", spaced)).toBe("my_note");
    expect(renderText("{{file.name|trim|lower}}", spaced)).toBe("my note");
    expect(renderText("{{empty|upper}}", ctx)).toBeNull();
  });

  it("keeps a pipe inside quoted filter arguments", () => {
    expect(renderText('{{aliases|join:"|"}}', ctx)).toBe("a|b");
  });

  it("an empty placeholder inside text yields null, not junk", () => {
    expect(renderText("x{{empty}}y", ctx)).toBeNull();
    expect(renderText("category/{{missing|name|snake}}", ctx)).toBeNull();
    expect(renderValue("category/{{missing}}", ctx)).toBeNull();
    expect(renderText("category/{{none}}", { ...ctx, frontmatter: { none: [] } })).toEqual([]);
  });

  it("throws on unknown filter", () => {
    expect(() => renderText("{{meta|bogus}}", ctx)).toThrow(TemplateError);
  });

  it("expands templates in a query with quoting", () => {
    const spaced = { ...ctx, file: { ...ctx.file, name: 'My "Note"' } };
    expect(expandTemplatesInQuery("end<{{today}} AND name={{file.name}}", spaced)).toBe(
      'end<2026-09-18 AND name="My \\"Note\\""'
    );
    expect(expandTemplatesInQuery("x={{category|name}}", ctx)).toBe('x="data science,Plans"');
    expect(expandTemplatesInQuery("plain", ctx)).toBe("plain");
  });
});
