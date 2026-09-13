import { setIcon } from "obsidian";
import type { FieldOption } from "../types";
import { renderPickerOptionContent } from "./picker-option";

/** Compact removal shortcuts; selection also stays in the full list below. */
export function renderPickerSelection(
  container: HTMLElement,
  options: FieldOption[],
  selected: Set<string>,
  onRemove: (value: string) => void
): void {
  const scrollLeft =
    container.querySelector<HTMLElement>(".mv-picker-selected-values")?.scrollLeft ?? 0;
  const focusedIndex = Array.from(container.querySelectorAll(".mv-picker-selected-chip")).indexOf(
    container.ownerDocument.activeElement as HTMLElement
  );
  container.empty();
  const values = container.createDiv("mv-picker-selected-values");
  values.setAttribute("tabindex", "0");
  values.setAttribute("role", "group");
  values.setAttribute("aria-label", "Selected values");

  const choices = new Map(options.map((option) => [option.value, option]));
  const ordered = new Set(
    options.filter((option) => selected.has(option.value)).map((option) => option.value)
  );
  for (const value of selected) ordered.add(value);

  if (ordered.size === 0) {
    values.createSpan({ text: "None", cls: "mv-picker-selected-empty" });
  }
  for (const value of ordered) {
    const option = choices.get(value) ?? { value };
    const button = values.createEl("button", {
      cls: "mv-picker-choice mv-picker-selected-chip",
      attr: { type: "button", "aria-label": `Remove ${option.label ?? value}` },
    });
    button.dataset.value = value;
    renderPickerOptionContent(button, option, true);
    const remove = button.createSpan({
      cls: "mv-picker-selected-remove",
      attr: { "aria-hidden": "true" },
    });
    setIcon(remove, "x");
    button.addEventListener("click", () => onRemove(value));
  }
  if (focusedIndex >= 0) {
    const buttons = values.querySelectorAll<HTMLButtonElement>("button");
    (buttons[Math.min(focusedIndex, buttons.length - 1)] ?? values).focus({ preventScroll: true });
  }
  values.scrollLeft = scrollLeft;
}
