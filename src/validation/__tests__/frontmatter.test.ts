import { describe, expect, it } from "vitest";
import { sanitizeFrontmatter } from "../frontmatter";

describe("sanitizeFrontmatter", () => {
  it("removes position property from frontmatter", () => {
    const result = sanitizeFrontmatter({
      title: "Test",
      position: { start: 1 },
    });
    expect(result).toEqual({ title: "Test" });
  });

  it("returns empty object for null input", () => {
    const result = sanitizeFrontmatter(null);
    expect(result).toEqual({});
  });

  it("returns empty object for undefined input", () => {
    const result = sanitizeFrontmatter(undefined);
    expect(result).toEqual({});
  });

  it("returns copy without mutating original", () => {
    const original = { title: "Test" };
    const result = sanitizeFrontmatter(original);
    expect(result).not.toBe(original);
    expect(result).toEqual(original);
  });
});
