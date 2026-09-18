import type { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { evaluateCondition, RuleConfigError } from "../condition";
import { contextForFile } from "../context";
import { makeEnv } from "./helpers";

describe("evaluateCondition", () => {
  it("string form uses the query language", async () => {
    const env = makeEnv({ status: "🟩", end: null });
    expect(await evaluateCondition("status=🟩 AND end=", env.self, env)).toBe(true);
    expect(await evaluateCondition("status=🟦", env.self, env)).toBe(false);
  });

  it("templates in string form refer to the rule note", async () => {
    const env = makeEnv({ end: "2026-01-01", start: "2026-02-01" });
    expect(await evaluateCondition("end<{{start}}", env.self, env)).toBe(true);
    expect(await evaluateCondition("end<{{today}}", env.self, env)).toBe(true);
  });

  it("selection form is true when at least one link passes", async () => {
    const env = makeEnv({ project: "[[P]]" }, { "p/P.md": { status: "🟩" } });
    expect(await evaluateCondition({ project: { when: "status=🟩" } }, env.self, env)).toBe(true);
    expect(await evaluateCondition({ project: { when: "status=🟦" } }, env.self, env)).toBe(false);
  });

  it("empty selection filter means has values", async () => {
    const full = makeEnv({ tasks: ["[[t]]"] });
    expect(await evaluateCondition({ tasks: {} }, full.self, full)).toBe(true);
    const empty = makeEnv({ tasks: [] });
    expect(await evaluateCondition({ tasks: {} }, empty.self, empty)).toBe(false);
  });

  it("and / or / not compose recursively", async () => {
    const env = makeEnv(
      { status: "🟩", tasks: ["[[a]]", "[[b]]"] },
      { "t/a.md": { status: "🟩" }, "t/b.md": { status: "🟦" } }
    );
    expect(await evaluateCondition({ and: ["status=🟩", { tasks: {} }] }, env.self, env)).toBe(
      true
    );
    expect(
      await evaluateCondition(
        { and: [{ tasks: {} }, { not: [{ tasks: { when: "-status=🟩" } }] }] },
        env.self,
        env
      )
    ).toBe(false);
    expect(await evaluateCondition({ or: ["status=🟦", "status=🟩"] }, env.self, env)).toBe(true);
    expect(await evaluateCondition({ or: ["status=🟦", "status=🟥"] }, env.self, env)).toBe(false);
    expect(await evaluateCondition({ not: ["status=🟩"] }, env.self, env)).toBe(false);
    expect(await evaluateCondition({ not: ["status=🟦"] }, env.self, env)).toBe(true);
    expect(await evaluateCondition({ and: [] }, env.self, env)).toBe(true);
  });

  it("all tasks done: has tasks and none not done", async () => {
    const files = { "t/a.md": { status: "🟩" }, "t/b.md": { status: "🟩" } };
    const env = makeEnv({ tasks: ["[[a]]", "[[b]]"] }, files);
    const cond = { and: [{ tasks: {} }, { not: [{ tasks: { when: "-status=🟩" } }] }] };
    expect(await evaluateCondition(cond, env.self, env)).toBe(true);
    const none = makeEnv({ tasks: [] }, files);
    expect(await evaluateCondition(cond, none.self, none)).toBe(false);
  });

  it("js form returns truthiness and respects the gate", async () => {
    const on = makeEnv({ status: "🟩" }, {}, true);
    expect(await evaluateCondition({ js: "return fm.status === '🟩'" }, on.self, on)).toBe(true);
    expect(await evaluateCondition({ js: "return 0" }, on.self, on)).toBe(false);
    const off = makeEnv({ status: "🟩" }, {}, false);
    await expect(evaluateCondition({ js: "return true" }, off.self, off)).rejects.toThrow(
      "disabled"
    );
  });

  it("rejects malformed conditions", async () => {
    const env = makeEnv({});
    await expect(evaluateCondition(5 as never, env.self, env)).rejects.toThrow(RuleConfigError);
    await expect(evaluateCondition({ and: "x" } as never, env.self, env)).rejects.toThrow(
      RuleConfigError
    );
    await expect(evaluateCondition({} as never, env.self, env)).rejects.toThrow(RuleConfigError);
  });
});

describe("contextForFile", () => {
  it("merges frontmatter and inline tags, drops position", () => {
    const app = {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: { tags: ["a", "#b"], position: {} },
          tags: [{ tag: "#c" }, { tag: "#a" }],
        }),
      },
    } as unknown as App;
    const ctx = contextForFile({ path: "x.md" } as TFile, app);
    expect(ctx.tags).toEqual(["a", "b", "c"]);
    expect(ctx.frontmatter).toEqual({ tags: ["a", "#b"] });
  });

  it("handles a note without cache", () => {
    const app = { metadataCache: { getFileCache: () => null } } as unknown as App;
    expect(contextForFile({ path: "x.md" } as TFile, app)).toEqual({
      path: "x.md",
      tags: [],
      frontmatter: {},
    });
  });
});
