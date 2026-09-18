import { describe, expect, it } from "vitest";
import { SelfWrites } from "../self-writes";

describe("SelfWrites", () => {
  it("consumes a mark once within the window", () => {
    let t = 0;
    const writes = new SelfWrites(1000, () => t);
    expect(writes.consume("a.md")).toBe(false);
    writes.mark("a.md");
    t = 500;
    expect(writes.consume("a.md")).toBe(true);
    expect(writes.consume("a.md")).toBe(false);
  });

  it("expires a mark after the window", () => {
    let t = 0;
    const writes = new SelfWrites(1000, () => t);
    writes.mark("a.md");
    t = 1500;
    expect(writes.consume("a.md")).toBe(false);
  });

  it("follows a rename", () => {
    const writes = new SelfWrites(1000, () => 0);
    writes.mark("a.md");
    writes.rename("a.md", "b.md");
    writes.rename("zzz.md", "q.md");
    expect(writes.consume("a.md")).toBe(false);
    expect(writes.consume("b.md")).toBe(true);
  });

  it("uses the real clock by default", () => {
    const writes = new SelfWrites();
    writes.mark("a.md");
    expect(writes.consume("a.md")).toBe(true);
  });
});
