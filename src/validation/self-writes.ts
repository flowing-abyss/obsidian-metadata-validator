/**
 * Remembers notes the plugin itself just wrote so the resulting metadata
 * "changed" event is not mistaken for a user edit. Without this every
 * auto-fix write would schedule another full validation of the same note.
 */
export class SelfWrites {
  private readonly stamps = new Map<string, number>();

  constructor(
    private readonly windowMs = 5_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  mark(path: string): void {
    this.stamps.set(path, this.now());
  }

  /** True once for the change event that follows our own write; false afterwards. */
  consume(path: string): boolean {
    const stamp = this.stamps.get(path);
    if (stamp === undefined) return false;
    this.stamps.delete(path);
    return this.now() - stamp < this.windowMs;
  }

  /** A rename keeps the pending mark with the new path. */
  rename(oldPath: string, newPath: string): void {
    const stamp = this.stamps.get(oldPath);
    if (stamp === undefined) return;
    this.stamps.delete(oldPath);
    this.stamps.set(newPath, stamp);
  }
}
