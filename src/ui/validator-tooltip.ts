import type { ValidationResult } from "../types";

const TOOLTIP_ID = "mv-validator-tooltip";

export function showValidatorTooltip(anchor: HTMLElement, results: ValidationResult[]): void {
  removeTooltip();

  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;

  const errors = results.filter((r) => !r.autoFixed);

  for (const result of errors) {
    const row = tooltip.createDiv("mv-tooltip-row");

    row.createEl("div", {
      text: result.message,
      cls: result.severity === "error" ? "mv-tooltip-error" : "mv-tooltip-warning",
    });

    const meta = row.createEl("div", { cls: "mv-tooltip-meta" });
    meta.textContent = `${result.rule} · ${result.manifestPath}`;

    const link = row.createEl("a", { text: "Open manifest →", cls: "mv-tooltip-link" });
    link.addEventListener("click", () => {
      removeTooltip();
      (
        window as unknown as {
          app: { workspace: { openLinkText: (p: string, s: string) => void } };
        }
      ).app.workspace.openLinkText(result.manifestPath, "");
    });
  }

  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + 4;
  const left = Math.min(rect.left, window.innerWidth - 340);
  tooltip.setCssProps({ top: `${top}px`, left: `${left}px` });

  document.body.appendChild(tooltip);

  const close = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node)) {
      removeTooltip();
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

function removeTooltip(): void {
  document.getElementById(TOOLTIP_ID)?.remove();
}
