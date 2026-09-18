import { describe, expect, it } from "vitest";
import type { ManifestField, ManifestRule } from "../../types";
import { runRules } from "../runner";
import { makeEnv, type VaultFiles } from "./helpers";

async function run(
  rules: ManifestRule[],
  fm: Record<string, unknown>,
  files: VaultFiles = {},
  enableJs = false,
  fields: Record<string, ManifestField> = {}
) {
  const env = makeEnv(fm, files, enableJs);
  const results = await runRules({
    rules,
    app: env.app,
    file: env.file,
    frontmatter: fm,
    fields,
    enableJs,
    manifestPath: "s/manifest.md",
    now: () => new Date("2026-09-18T12:00:00+07:00"),
  });
  return { fm, results };
}

describe("runRules", () => {
  it("sets end on done and reports", async () => {
    const { fm, results } = await run(
      [{ name: "end on done", when: "status=🟩 AND end=", then: { set: { end: "{{today}}" } } }],
      { status: "🟩", end: null }
    );
    expect(fm.end).toBe("2026-09-18");
    expect(results).toEqual([
      expect.objectContaining({
        field: "end",
        rule: "rules",
        severity: "info",
        autoFixed: true,
        manifestPath: "s/manifest.md",
        message: '"end" set by rule "end on done".',
      }),
    ]);
  });

  it("does nothing when already correct", async () => {
    const { results } = await run(
      [{ when: "status=🟩 AND end=", then: { set: { end: "{{today}}" } } }],
      { status: "🟩", end: "2026-01-01" }
    );
    expect(results).toEqual([]);
  });

  it("drop clears end and lowers priority", async () => {
    const { fm } = await run(
      [{ when: "status=⬛", then: { set: { end: null, priority: "⏬" } } }],
      {
        status: "⬛",
        end: "2026-01-01",
        priority: "◽",
      }
    );
    expect(fm.end).toBeNull();
    expect(fm.priority).toBe("⏬");
  });

  it("transfer works in either verb order (snapshot reads)", async () => {
    const files = {
      "m/a.md": { tags: ["system/high/problem"] },
      "m/b.md": { tags: ["system/high/meta"] },
    };
    const rule = (order: "add-first" | "remove-first"): ManifestRule => ({
      then:
        order === "add-first"
          ? {
              add: { problem: { meta: { when: "#system/high/problem" } } },
              remove: { meta: { when: "#system/high/problem" } },
            }
          : {
              remove: { meta: { when: "#system/high/problem" } },
              add: { problem: { meta: { when: "#system/high/problem" } } },
            },
    });
    for (const order of ["add-first", "remove-first"] as const) {
      const { fm } = await run([rule(order)], { meta: ["[[a]]", "[[b]]"], problem: [] }, files);
      expect(fm.meta).toEqual(["[[b]]"]);
      expect(fm.problem).toEqual(["[[a]]"]);
    }
  });

  it("two-way transfer in one rule", async () => {
    const files = {
      "m/a.md": { tags: ["system/high/problem"] },
      "m/b.md": { tags: ["system/high/meta"] },
    };
    const rule: ManifestRule = {
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
    };
    const { fm, results } = await run([rule], { meta: ["[[a]]"], problem: ["[[b]]"] }, files);
    expect(fm.meta).toEqual(["[[b]]"]);
    expect(fm.problem).toEqual(["[[a]]"]);
    expect(results.map((r) => r.message)).toEqual([
      '"problem" extended by rule "#1".',
      '"meta" extended by rule "#1".',
      '"meta" trimmed by rule "#1".',
      '"problem" trimmed by rule "#1".',
    ]);
  });

  it("set with a bare filter keeps only the matching links", async () => {
    const files = { "m/a.md": { tags: ["keep"] }, "m/b.md": { tags: ["drop"] } };
    const { fm } = await run(
      [{ then: { set: { meta: { when: "#keep" } } } }],
      { meta: ["[[a]]", "[[b]]"] },
      files
    );
    expect(fm.meta).toEqual(["[[a]]"]);
  });

  it("tag mirror: remove then add in one rule", async () => {
    const { fm } = await run(
      [{ when: "status=🟩", then: { remove: { tags: "status/*" }, add: { tags: "status/done" } } }],
      { status: "🟩", tags: ["status/wip", "category/x"] }
    );
    expect(fm.tags).toEqual(["category/x", "status/done"]);
  });

  it("link to tag mirror with filters", async () => {
    const { fm } = await run(
      [
        {
          when: "-#mark/no_sync",
          then: {
            remove: { tags: "category/*" },
            add: { tags: "category/{{category|name|snake}}" },
          },
        },
      ],
      { category: ["[[Data Science]]", "[[plans]]"], tags: ["category/old", "note"] }
    );
    expect(fm.tags).toEqual(["note", "category/data_science", "category/plans"]);
  });

  it("no_sync guard skips the mirror", async () => {
    const { fm, results } = await run(
      [{ when: "-#mark/no_sync", then: { remove: { tags: "category/*" } } }],
      { tags: ["category/old", "mark/no_sync"] }
    );
    expect(fm.tags).toEqual(["category/old", "mark/no_sync"]);
    expect(results).toEqual([]);
  });

  it("later rules see earlier results", async () => {
    const { fm } = await run(
      [{ then: { set: { a: "1" } } }, { when: "a=1", then: { set: { b: "2" } } }],
      {}
    );
    expect(fm.b).toBe("2");
  });

  it("add on a scalar field is a config warning and not applied", async () => {
    const { fm, results } = await run(
      [{ then: { add: { status: "x" } } }],
      { status: "a" },
      {},
      false,
      {
        status: { type: "select" },
      }
    );
    expect(fm.status).toBe("a");
    expect(results[0]).toEqual(
      expect.objectContaining({ rule: "rule-config", severity: "warning", field: "__rules__" })
    );
    expect(results[0]?.message).toContain('"add" needs a list field');
  });

  it("set on a fixed field is a config warning", async () => {
    const { fm, results } = await run(
      [{ then: { set: { icon: "x" } } }],
      { icon: "📚" },
      {},
      false,
      {
        icon: { type: "text", fixed: "📚" },
      }
    );
    expect(fm.icon).toBe("📚");
    expect(results[0]?.rule).toBe("rule-config");
  });

  it("set follows the declared field shape", async () => {
    const files = { "r/a.md": { tags: ["book"] }, "r/b.md": { tags: ["book"] } };
    const { fm } = await run(
      [{ then: { set: { source: { related: { when: "#book" } } } } }],
      { related: ["[[a]]", "[[b]]"] },
      files,
      false,
      { source: { type: "link" } }
    );
    expect(fm.source).toEqual(["[[a]]", "[[b]]"]);
  });

  it("js then mutates and reports changed keys", async () => {
    const { fm, results } = await run(
      [{ then: { js: "fm.tags = ['priority/high']; fm.extra = 1" } }],
      { tags: [] },
      {},
      true
    );
    expect(fm.tags).toEqual(["priority/high"]);
    expect(results.map((r) => r.field)).toEqual(["tags", "extra"]);
    expect(results[0]).toEqual(expect.objectContaining({ rule: "rules", autoFixed: true }));
  });

  it("js receives the snapshot", async () => {
    const { fm } = await run(
      [{ then: { set: { a: "new" }, js: "fm.b = snapshot.a" } }],
      { a: "old" },
      {},
      true
    );
    expect(fm.a).toBe("new");
    expect(fm.b).toBe("old");
  });

  it("js disabled yields a warning and skips the rule", async () => {
    const { fm, results } = await run(
      [{ when: { js: "return true" }, then: { set: { a: 1 } } }],
      {},
      {},
      false
    );
    expect(fm.a).toBeUndefined();
    expect(results[0]).toEqual(
      expect.objectContaining({ severity: "warning", rule: "rules", field: "__rules__" })
    );
    expect(results[0]?.message).toContain("JS validation disabled");
  });

  it("js errors are reported as config warnings", async () => {
    const { results } = await run([{ then: { js: "throw new Error('boom')" } }], {}, {}, true);
    expect(results[0]?.message).toBe('Rule "#1": failed: boom');
  });

  it("template errors are reported as config warnings", async () => {
    const { results } = await run([{ then: { set: { a: "{{b|bogus}}" } } }], { b: "x" });
    expect(results[0]?.rule).toBe("rule-config");
    expect(results[0]?.message).toContain("Unknown template filter");
  });

  it("labels fall back to the when text and the index", async () => {
    const { results } = await run(
      [{ when: "a=", then: { set: { a: "x" } } }, { then: { set: { b: "y" } } }],
      {}
    );
    expect(results[0]?.message).toBe('"a" set by rule "a=".');
    expect(results[1]?.message).toBe('"b" set by rule "#2".');
  });

  it("malformed rules are skipped with a warning", async () => {
    const { results } = await run(
      [
        { then: { bogus: 1 } as never },
        { then: undefined as never },
        { then: { set: "x" } as never },
        { when: { and: "x" } as never, then: { set: { z: 1 } } },
        { then: { set: { a: 1 } } },
      ],
      {}
    );
    expect(results.map((r) => r.rule)).toEqual([
      "rule-config",
      "rule-config",
      "rule-config",
      "rule-config",
      "rules",
    ]);
  });

  it("kanban inside properties", async () => {
    const files = {
      "t/a.md": { status: "🟩" },
      "t/b.md": { status: "🟦" },
      "t/c.md": { status: "🟥" },
    };
    const rule: ManifestRule = {
      then: {
        add: {
          wip: { todo: { when: "status=🟦" }, done: { when: "status=🟦" } },
          done: { todo: { when: "status=🟩" }, wip: { when: "status=🟩" } },
        },
        remove: {
          todo: { when: "-status=🟥" },
          wip: { when: "-status=🟦" },
          done: { when: "-status=🟩" },
        },
      },
    };
    const { fm } = await run(
      [rule],
      { todo: ["[[a]]", "[[b]]", "[[c]]"], wip: [], done: [] },
      files
    );
    expect(fm.todo).toEqual(["[[c]]"]);
    expect(fm.wip).toEqual(["[[b]]"]);
    expect(fm.done).toEqual(["[[a]]"]);
  });

  it("state from neighbours: project done closes the task", async () => {
    const files = { "p/P.md": { status: "🟩" } };
    const rule: ManifestRule = {
      when: { project: { when: "status=🟩" } },
      then: { set: { status: "🟩" } },
    };
    expect((await run([rule], { project: "[[P]]", status: "🟦" }, files)).fm.status).toBe("🟩");
  });

  it("state from neighbours: all tasks done", async () => {
    const files = { "t/a.md": { status: "🟩" }, "t/b.md": { status: "🟩" } };
    const rule: ManifestRule = {
      when: { and: [{ tasks: {} }, { not: [{ tasks: { when: "-status=🟩" } }] }] },
      then: { set: { status: "🟩" } },
    };
    expect((await run([rule], { tasks: ["[[a]]", "[[b]]"], status: "🟦" }, files)).fm.status).toBe(
      "🟩"
    );
    expect((await run([rule], { tasks: [], status: "🟦" }, files)).fm.status).toBe("🟦");
  });

  it("overdue via comparison with today, and the reverse", async () => {
    const rules: ManifestRule[] = [
      { when: "end<{{today}} AND -status=🟩", then: { add: { tags: "mark/overdue" } } },
      {
        when: { or: ["end>={{today}}", "status=🟩", "end="] },
        then: { remove: { tags: "mark/overdue" } },
      },
    ];
    expect((await run(rules, { end: "2026-01-01", status: "🟦", tags: [] })).fm.tags).toEqual([
      "mark/overdue",
    ]);
    expect(
      (await run(rules, { end: "2026-01-01", status: "🟩", tags: ["mark/overdue"] })).fm.tags
    ).toEqual([]);
    expect((await run(rules, { end: null, status: "🟦", tags: ["mark/overdue"] })).fm.tags).toEqual(
      []
    );
  });

  it("end before start is fixed from start", async () => {
    const { fm } = await run([{ when: "end<{{start}}", then: { set: { end: "{{start}}" } } }], {
      start: "2026-02-01",
      end: "2026-01-01",
    });
    expect(fm.end).toBe("2026-02-01");
  });

  it("tasks ending after the project", async () => {
    const files = { "t/a.md": { end: "2026-04-01" }, "t/b.md": { end: "2026-02-01" } };
    const { fm } = await run(
      [{ then: { add: { overdue_tasks: { tasks: { when: "end>{{end}}" } } } } }],
      { end: "2026-03-01", tasks: ["[[a]]", "[[b]]"] },
      files
    );
    expect(fm.overdue_tasks).toEqual(["[[a]]"]);
  });
});
