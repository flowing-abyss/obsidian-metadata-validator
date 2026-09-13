import { setTooltip } from "obsidian";
import type { FieldOption } from "../types";
import { descriptionText } from "../utils/descriptions";

/** Use the same label in the full list and its compact selected shortcuts. */
export function renderPickerOptionContent(
  item: HTMLElement,
  option: FieldOption,
  compact = false
): void {
  const copy = item.createSpan({ cls: "mv-picker-option-copy" });
  copy.createSpan({ text: option.label ?? option.value, cls: "mv-picker-option-label" });
  const description = descriptionText(option.description);
  if (compact) {
    setTooltip(
      item,
      [option.label ?? option.value, description, "Click to remove"].filter(Boolean).join("\n")
    );
  } else {
    if (description) copy.createSpan({ text: description, cls: "mv-option-help" });
    if (option.label && option.label !== option.value) {
      item.createSpan({ text: option.value, cls: "mv-picker-value-hint" });
    }
  }
}
