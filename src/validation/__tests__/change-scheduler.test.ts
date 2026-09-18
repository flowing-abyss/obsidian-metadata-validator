import type { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeScheduler } from "../change-scheduler";

function makeFile(path: string): TFile {
  return { path, basename: path.replace(/\.md$/, ""), extension: "md" } as TFile;
}

describe("ChangeScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once after the delay when the same file changes repeatedly", () => {
    const run = vi.fn();
    const scheduler = new ChangeScheduler(run, () => 1000);
    const file = makeFile("a.md");

    scheduler.schedule(file);
    vi.advanceTimersByTime(600);
    scheduler.schedule(file);
    vi.advanceTimersByTime(600);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(file);
  });

  it("tracks files independently", () => {
    const run = vi.fn();
    const scheduler = new ChangeScheduler(run, () => 1000);
    const a = makeFile("a.md");
    const b = makeFile("b.md");

    scheduler.schedule(a);
    scheduler.schedule(b);
    vi.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(a);
    expect(run).toHaveBeenCalledWith(b);
  });

  it("follows the file across a rename (same TFile instance)", () => {
    const run = vi.fn();
    const scheduler = new ChangeScheduler(run, () => 1000);
    const file = makeFile("old/a.md");

    scheduler.schedule(file);
    file.path = "new/a.md";
    scheduler.schedule(file);
    vi.advanceTimersByTime(1000);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(file);
  });

  it("runs on the next tick when the delay is zero", () => {
    const run = vi.fn();
    const scheduler = new ChangeScheduler(run, () => 0);

    scheduler.schedule(makeFile("a.md"));
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reads the delay at schedule time so settings changes apply immediately", () => {
    const run = vi.fn();
    let delay = 5000;
    const scheduler = new ChangeScheduler(run, () => delay);

    delay = 100;
    scheduler.schedule(makeFile("a.md"));
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancels everything pending on dispose", () => {
    const run = vi.fn();
    const scheduler = new ChangeScheduler(run, () => 1000);

    scheduler.schedule(makeFile("a.md"));
    scheduler.schedule(makeFile("b.md"));
    scheduler.dispose();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });
});
