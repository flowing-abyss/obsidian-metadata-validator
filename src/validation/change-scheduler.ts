import type { TFile } from "obsidian";

/**
 * Coalesces bursts of changes to the same note into a single delayed run.
 *
 * Keyed by TFile instance rather than path so a note that is renamed while
 * pending (e.g. an enforce_folder move) still gets exactly one run.
 */
export class ChangeScheduler {
  private readonly pending = new Map<TFile, ReturnType<typeof window.setTimeout>>();

  constructor(
    private readonly run: (file: TFile) => void,
    private readonly delayMs: () => number
  ) {}

  schedule(file: TFile): void {
    const existing = this.pending.get(file);
    if (existing !== undefined) window.clearTimeout(existing);
    this.pending.set(
      file,
      window.setTimeout(() => {
        this.pending.delete(file);
        this.run(file);
      }, this.delayMs())
    );
  }

  dispose(): void {
    for (const timer of this.pending.values()) window.clearTimeout(timer);
    this.pending.clear();
  }
}
