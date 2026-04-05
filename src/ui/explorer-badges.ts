const BADGE_CLASS = "mv-explorer-badge";

type BadgeStatus = "error" | "warning" | "valid" | "none";

const STATUS_CLASS: Record<Exclude<BadgeStatus, "none">, string> = {
  error: "mv-badge-error",
  warning: "mv-badge-warning",
  valid: "mv-badge-valid",
};

export class ExplorerBadges {
  private readonly badgeMap: Map<string, BadgeStatus> = new Map();

  setStatus(filePath: string, status: BadgeStatus): void {
    this.badgeMap.set(filePath, status);
  }

  clearAll(): void {
    this.badgeMap.clear();
    Array.from(document.querySelectorAll(`.${BADGE_CLASS}`)).forEach((el) => el.remove());
  }

  render(): void {
    Array.from(document.querySelectorAll(`.${BADGE_CLASS}`)).forEach((el) => el.remove());

    const fileItems = Array.from(document.querySelectorAll<HTMLElement>(".nav-file-title"));
    for (const item of fileItems) {
      const navFile = item.closest(".nav-file");
      const filePath = navFile instanceof HTMLElement ? navFile.getAttribute("data-path") : null;
      if (!filePath) continue;

      const status = this.badgeMap.get(filePath) ?? "none";
      if (status === "none") continue;

      const badge = document.createElement("span");
      badge.className = `${BADGE_CLASS} ${STATUS_CLASS[status]}`;

      item.appendChild(badge);
    }
  }
}
