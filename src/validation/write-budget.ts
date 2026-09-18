/**
 * Sliding-window budget of rule-triggered writes per note.
 *
 * Rules on two notes that depend on each other can disagree forever, each
 * write re-triggering the other. Unchanged notes are never written, which
 * stops agreeing rules; this budget stops disagreeing ones.
 */
export class WriteBudget {
  private readonly stamps = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 30_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Record an intended write. False when the note already used its budget in the window. */
  allow(path: string): boolean {
    const t = this.now();
    const recent = (this.stamps.get(path) ?? []).filter((s) => t - s < this.windowMs);
    if (recent.length >= this.max) {
      this.stamps.set(path, recent);
      return false;
    }
    recent.push(t);
    this.stamps.set(path, recent);
    return true;
  }
}
