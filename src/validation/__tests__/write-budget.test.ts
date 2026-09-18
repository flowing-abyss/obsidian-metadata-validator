import { describe, expect, it } from "vitest";
import { WriteBudget } from "../write-budget";

describe("WriteBudget", () => {
  it("allows up to max writes in the window, then denies", () => {
    let t = 0;
    const budget = new WriteBudget(3, 1000, () => t);
    expect(budget.allow("a.md")).toBe(true);
    expect(budget.allow("a.md")).toBe(true);
    expect(budget.allow("a.md")).toBe(true);
    expect(budget.allow("a.md")).toBe(false);
    t = 500;
    expect(budget.allow("a.md")).toBe(false);
    t = 1001;
    expect(budget.allow("a.md")).toBe(true);
  });

  it("tracks notes independently", () => {
    const budget = new WriteBudget(1, 1000, () => 0);
    expect(budget.allow("a.md")).toBe(true);
    expect(budget.allow("b.md")).toBe(true);
    expect(budget.allow("a.md")).toBe(false);
  });

  it("uses the real clock by default", () => {
    const budget = new WriteBudget(1);
    expect(budget.allow("a.md")).toBe(true);
    expect(budget.allow("a.md")).toBe(false);
  });
});
