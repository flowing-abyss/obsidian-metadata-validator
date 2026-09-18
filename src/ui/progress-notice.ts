import { Notice } from "obsidian";

export interface ProgressState {
  processed: number;
  total: number;
}

/** Text progress bar for a long vault operation, e.g. `[#####.........] 120/3678 (3%)`. */
export function formatProgress(label: string, progress: ProgressState, width = 14): string {
  const total = Math.max(0, progress.total);
  const processed = Math.max(
    0,
    total > 0 ? Math.min(progress.processed, total) : progress.processed
  );
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const filled = total > 0 ? Math.round(Math.max(0, Math.min(1, processed / total)) * width) : 0;
  const bar = `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
  const totalText = total > 0 ? String(total) : "?";
  return `${label} ${bar} ${processed}/${totalText} (${percent}%)`;
}

/** A single Notice that stays open while a vault operation runs and reports its progress. */
export class ProgressNotice {
  private readonly notice: Notice;

  constructor(private readonly label: string) {
    this.notice = new Notice(formatProgress(label, { processed: 0, total: 0 }), 0);
  }

  update(progress: ProgressState): void {
    this.notice.setMessage(formatProgress(this.label, progress));
  }

  /** Replace the bar with a final message and close after `ms`. */
  finish(message: string, ms = 1200): void {
    this.notice.setMessage(message);
    window.setTimeout(() => this.notice.hide(), ms);
  }
}
