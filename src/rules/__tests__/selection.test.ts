import { describe, expect, it } from "vitest";
import { isSelection, resolveSelection } from "../selection";
import { makeEnv } from "./helpers";

describe("isSelection", () => {
  it("recognises selection objects", () => {
    expect(isSelection({ meta: { when: "#x" } })).toBe(true);
    expect(isSelection({ meta: {} })).toBe(true);
    expect(isSelection({ meta: {}, problem: { when: "#y" } })).toBe(true);
    expect(isSelection({ js: "x" })).toBe(false);
    expect(isSelection({ and: [] })).toBe(false);
    expect(isSelection({ meta: { when: "#x", extra: 1 } })).toBe(false);
    expect(isSelection({ meta: "x" })).toBe(false);
    expect(isSelection({ meta: [] })).toBe(false);
    expect(isSelection({})).toBe(false);
    expect(isSelection("x")).toBe(false);
    expect(isSelection(null)).toBe(false);
  });
});

describe("resolveSelection", () => {
  it("selects links whose target passes, skipping unresolved and strings", async () => {
    const env = makeEnv(
      { meta: ["[[a]]", "[[ghost]]", "plain", "[[b]]"] },
      { "m/a.md": { tags: ["system/high/problem"] }, "m/b.md": { tags: ["system/high/meta"] } }
    );
    expect(await resolveSelection({ meta: { when: "#system/high/problem" } }, env.self, env)).toEqual(
      ["[[a]]"]
    );
    expect(await resolveSelection({ meta: { when: "-#system/high/problem" } }, env.self, env)).toEqual(
      ["[[b]]"]
    );
  });

  it("without a filter selects all values including strings", async () => {
    const env = makeEnv({ meta: ["[[a]]", "plain", null, ""] });
    expect(await resolveSelection({ meta: {} }, env.self, env)).toEqual(["[[a]]", "plain"]);
  });

  it("missing property selects nothing", async () => {
    const env = makeEnv({});
    expect(await resolveSelection({ meta: {} }, env.self, env)).toEqual([]);
  });

  it("scalar link property yields one value", async () => {
    const env = makeEnv({ project: "[[P]]" }, { "p/P.md": { status: "🟩" } });
    expect(await resolveSelection({ project: { when: "status=🟩" } }, env.self, env)).toEqual([
      "[[P]]",
    ]);
  });

  it("several keys are a union without duplicates", async () => {
    const env = makeEnv(
      { todo: ["[[a]]"], wip: ["[[x/a]]", "[[b]]"] },
      { "t/a.md": { status: "🟩" }, "t/b.md": { status: "🟩" } }
    );
    expect(
      await resolveSelection(
        { todo: { when: "status=🟩" }, wip: { when: "status=🟩" } },
        env.self,
        env
      )
    ).toEqual(["[[a]]", "[[b]]"]);
  });

  it("templates inside a selection refer to the rule note", async () => {
    const env = makeEnv(
      { end: "2026-03-01", tasks: ["[[a]]", "[[b]]"] },
      { "t/a.md": { end: "2026-04-01" }, "t/b.md": { end: "2026-02-01" } }
    );
    expect(await resolveSelection({ tasks: { when: "end>{{end}}" } }, env.self, env)).toEqual([
      "[[a]]",
    ]);
  });

  it("nested selections look one link further", async () => {
    const env = makeEnv(
      { tasks: ["[[a]]"] },
      { "t/a.md": { project: "[[P]]" }, "p/P.md": { status: "🟩" } }
    );
    expect(
      await resolveSelection({ tasks: { when: { project: { when: "status=🟩" } } } }, env.self, env)
    ).toEqual(["[[a]]"]);
  });
});
