import { describe, expect, it } from "vitest";
import { applyAdd, applyRemove, applySet, isListField, resolveRuleValue } from "../verbs";
import { makeEnv } from "./helpers";

describe("isListField", () => {
  it("accepts list-like and undeclared fields", () => {
    expect(isListField(undefined)).toBe(true);
    expect(isListField({ type: "list" })).toBe(true);
    expect(isListField({ type: "multiselect" })).toBe(true);
    expect(isListField({ type: "multilink" })).toBe(true);
    expect(isListField({ type: "select" })).toBe(false);
    expect(isListField({ type: "link" })).toBe(false);
  });
});

describe("applySet", () => {
  it("writes scalars and reports change", () => {
    const fm: Record<string, unknown> = { end: null };
    expect(applySet(fm, "end", "2026-09-18")).toBe(true);
    expect(fm.end).toBe("2026-09-18");
    expect(applySet(fm, "end", "2026-09-18")).toBe(false);
  });

  it("null clears, undefined clears, list replaces, equal list is not a change", () => {
    const fm: Record<string, unknown> = { tags: ["a"] };
    expect(applySet(fm, "tags", ["a"])).toBe(false);
    expect(applySet(fm, "tags", ["b"])).toBe(true);
    expect(applySet(fm, "tags", null)).toBe(true);
    expect(fm.tags).toBeNull();
    expect(applySet(fm, "tags", undefined)).toBe(false);
    expect(applySet(fm, "tags", "x")).toBe(true);
    expect(applySet(fm, "tags", ["x"])).toBe(true);
  });

  it("scalar field: one element as scalar, many as list, none as null", () => {
    const fm: Record<string, unknown> = {};
    applySet(fm, "source", ["[[a]]"], { type: "link" });
    expect(fm.source).toBe("[[a]]");
    applySet(fm, "source", ["[[a]]", "[[b]]"], { type: "link" });
    expect(fm.source).toEqual(["[[a]]", "[[b]]"]);
    applySet(fm, "source", [], { type: "link" });
    expect(fm.source).toBeNull();
  });

  it("list field always gets a list", () => {
    const fm: Record<string, unknown> = {};
    applySet(fm, "meta", "[[a]]", { type: "multilink" });
    expect(fm.meta).toEqual(["[[a]]"]);
    applySet(fm, "meta", null, { type: "multilink" });
    expect(fm.meta).toBeNull();
  });
});

describe("applyAdd", () => {
  it("adds without duplicates, links by name, creates the list", () => {
    const fm: Record<string, unknown> = {};
    expect(applyAdd(fm, "problem", ["[[x/a]]"])).toBe(true);
    expect(applyAdd(fm, "problem", ["[[a]]"])).toBe(false);
    expect(applyAdd(fm, "problem", ["[[b]]", null, "", "[[b]]"])).toBe(true);
    expect(fm.problem).toEqual(["[[x/a]]", "[[b]]"]);
  });

  it("keeps array identity when nothing is added", () => {
    const arr = ["a"];
    const fm: Record<string, unknown> = { tags: arr };
    applyAdd(fm, "tags", ["a"]);
    expect(fm.tags).toBe(arr);
  });

  it("wraps a scalar current value", () => {
    const fm: Record<string, unknown> = { tags: "a" };
    applyAdd(fm, "tags", ["b"]);
    expect(fm.tags).toEqual(["a", "b"]);
  });

  it("treats null current value as empty list", () => {
    const fm: Record<string, unknown> = { tags: null };
    applyAdd(fm, "tags", ["b"]);
    expect(fm.tags).toEqual(["b"]);
  });
});

describe("applyRemove", () => {
  it("removes literals, masks and links", () => {
    const fm: Record<string, unknown> = {
      tags: ["status/wip", "status/done", "category/x", "mark/a"],
      meta: ["[[x/a]]", "[[b]]"],
    };
    expect(applyRemove(fm, "tags", ["status/*", "mark/a"])).toBe(true);
    expect(fm.tags).toEqual(["category/x"]);
    expect(applyRemove(fm, "meta", ["[[a]]"])).toBe(true);
    expect(fm.meta).toEqual(["[[b]]"]);
    expect(applyRemove(fm, "meta", ["[[zzz]]"])).toBe(false);
  });

  it("masks match link names and escape regex characters", () => {
    const fm: Record<string, unknown> = { meta: ["[[x/a.b]]", "[[c]]"], tags: ["a.b", "axb"] };
    expect(applyRemove(fm, "meta", ["a.*"])).toBe(true);
    expect(fm.meta).toEqual(["[[c]]"]);
    expect(applyRemove(fm, "tags", ["a.b"])).toBe(true);
    expect(fm.tags).toEqual(["axb"]);
  });

  it("* clears the list and a missing or scalar property is a no-op", () => {
    const fm: Record<string, unknown> = { tags: ["a", "b"], status: "x" };
    expect(applyRemove(fm, "tags", ["*"])).toBe(true);
    expect(fm.tags).toEqual([]);
    expect(applyRemove(fm, "nothing", ["*"])).toBe(false);
    expect(applyRemove(fm, "status", ["*"])).toBe(false);
  });

  it("keeps array identity when nothing matches", () => {
    const arr = ["a"];
    const fm: Record<string, unknown> = { tags: arr };
    expect(applyRemove(fm, "tags", ["b"])).toBe(false);
    expect(fm.tags).toBe(arr);
  });
});

describe("resolveRuleValue", () => {
  it("returns literals, renders templates, resolves selections, flattens arrays", async () => {
    const env = makeEnv(
      { category: ["[[Data Science]]"], meta: ["[[a]]", "[[b]]"] },
      { "m/a.md": { tags: ["p"] }, "m/b.md": { tags: ["q"] } }
    );
    expect(await resolveRuleValue("status/done", env)).toBe("status/done");
    expect(await resolveRuleValue(null, env)).toBeNull();
    expect(await resolveRuleValue(7, env)).toBe(7);
    expect(await resolveRuleValue("category/{{category|name|snake}}", env)).toEqual([
      "category/data_science",
    ]);
    expect(await resolveRuleValue("{{meta}}", env)).toEqual(["[[a]]", "[[b]]"]);
    expect(await resolveRuleValue({ meta: { when: "#p" } }, env)).toEqual(["[[a]]"]);
    expect(await resolveRuleValue(["x", "{{meta}}", null, ""], env)).toEqual([
      "x",
      "[[a]]",
      "[[b]]",
    ]);
    expect(await resolveRuleValue({ nested: { deep: 1 } }, env)).toEqual({ nested: { deep: 1 } });
  });

  it("js values use the gate", async () => {
    const on = makeEnv({ status: "🟩" }, {}, true);
    expect(await resolveRuleValue({ js: "return fm.status + '!'" }, on)).toBe("🟩!");
    const off = makeEnv({ status: "🟩" }, {}, false);
    await expect(resolveRuleValue({ js: "return 1" }, off)).rejects.toThrow("disabled");
  });
});
