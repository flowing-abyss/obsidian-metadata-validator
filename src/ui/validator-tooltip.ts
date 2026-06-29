import type { ValidationResult } from "../types";

const TOOLTIP_ID = "mv-validator-tooltip";

export function showValidatorTooltip(anchor: HTMLElement, results: ValidationResult[]): void {
  removeTooltip();

  const tooltip = activeDocument.body.createDiv();
  tooltip.id = TOOLTIP_ID;

  const errors = results.filter((r) => !r.autoFixed);

  for (const result of errors) {
    const row = tooltip.createDiv("mv-tooltip-row");

    row.createDiv({
      text: result.message,
      cls: result.severity === "error" ? "mv-tooltip-error" : "mv-tooltip-warning",
    });

    const meta = row.createDiv({ cls: "mv-tooltip-meta" });
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

  const close = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node)) {
      removeTooltip();
      activeDocument.removeEventListener("click", close);
    }
  };
  window.setTimeout(() => activeDocument.addEventListener("click", close), 0);
}

function removeTooltip(): void {
  activeDocument.getElementById(TOOLTIP_ID)?.remove();
}
