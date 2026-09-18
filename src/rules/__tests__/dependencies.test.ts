import { describe, expect, it } from "vitest";
import type { ManifestRule } from "../../types";
import { collectLinkDependencies, linksThrough } from "../dependencies";

describe("collectLinkDependencies", () => {
  it("finds templates that follow a link, in values and in conditions", () => {
    const rules: ManifestRule[] = [
      { then: { set: { category: "{{project>category}}", meta: "{{ project > meta }}" } } },
      { when: "end>{{milestone>end}}", then: { add: { tags: "late" } } },
      { then: { add: { tags: ["x", "area/{{area>title|snake}}"] } } },
    ];
    expect(collectLinkDependencies(rules).sort()).toEqual(["area", "milestone", "project"]);
  });

  it("finds selections that filter by the linked note", () => {
    const rules: ManifestRule[] = [
      { when: { project: { when: "status=done" } }, then: { set: { status: "done" } } },
      { when: { and: [{ tasks: {} }, { not: [{ tasks: { when: "-status=done" } }] }] }, then: {} },
      {
        then: {
          add: { problem: { meta: { when: "#problem" } } },
          remove: { category: { when: "#meta" } },
        },
      },
    ];
    expect(collectLinkDependencies(rules).sort()).toEqual(["category", "meta", "project", "tasks"]);
  });

  it("ignores selections without a filter, plain values, js and malformed rules", () => {
    const rules = [
      { when: { tasks: {} }, then: { add: { done: { todo: {} } }, set: { a: 1, b: null } } },
      { when: { js: "return true" }, then: { js: "fm.x = '{{project>category}}'" } },
      { when: "status=done AND end=", then: { set: { end: "{{today}}" } } },
      null,
      { then: "nope" },
      { then: { set: "nope" } },
    ] as unknown as ManifestRule[];
    expect(collectLinkDependencies(rules)).toEqual([]);
  });

  it("looks for templates inside a selection's condition", () => {
    const rules: ManifestRule[] = [
      { then: { add: { late: { tasks: { when: "end>{{project>end}}" } } } } },
    ];
    expect(collectLinkDependencies(rules).sort()).toEqual(["project", "tasks"]);
  });
});

describe("linksThrough", () => {
  it("matches a link by note name in any of the properties", () => {
    const fm = { project: "[[work/Alpha|A]]", meta: ["[[x]]", "plain"], other: "[[Beta]]" };
    expect(linksThrough(fm, ["project"], "Alpha")).toBe(true);
    expect(linksThrough(fm, ["meta", "project"], "x")).toBe(true);
    expect(linksThrough(fm, ["project", "meta"], "Beta")).toBe(false);
    expect(linksThrough(fm, ["missing"], "Alpha")).toBe(false);
    expect(linksThrough(fm, ["meta"], "plain")).toBe(false);
  });
});
