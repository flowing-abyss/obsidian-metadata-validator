import { renderMatches, setIcon } from "obsidian";
import type { FuzzyMatch } from "obsidian";
import type { KeyboardPropertyItem } from "../types";

export function renderKeyboardProperty(
  { item, match }: FuzzyMatch<KeyboardPropertyItem>,
  el: HTMLElement,
  selected: boolean
): void {
  el.addClass("mod-complex");
  if (item.section) el.setAttribute("data-section", item.section);
  el.toggleClass("mv-property-pinned", !!item.pinned);
  el.dataset.copy = item.pinned ? "selected" : "all";
  const content = el.createDiv("suggestion-content");
  const title = content.createDiv("suggestion-title");
  renderMatches(
    title,
    item.label,
    match.matches
      .filter(([start]) => start < item.label.length)
      .map(([start, end]): [number, number] => [start, Math.min(end, item.label.length)])
  );
  if (item.description) content.createDiv({ cls: "suggestion-note", text: item.description });
  if (item.kind === "property") {
    el.createDiv({ cls: "suggestion-aux mv-property-type", text: item.property.field.type });
  } else if (item.kind === "option") {
    el.dataset.value = item.option.value;
    const aux = el.createDiv("suggestion-aux");
    if (item.option.group) aux.createSpan({ cls: "mv-property-type", text: item.option.group });
    const mark = aux.createSpan({ cls: "mv-property-check", attr: { "aria-hidden": "true" } });
    setIcon(mark, "check");
    updateKeyboardPropertySelection(el, selected);
  }
}

function updateKeyboardPropertySelection(el: HTMLElement, selected: boolean): void {
  el.toggleClass("mv-property-option-selected", selected);
  el.setAttribute("aria-checked", String(selected));
}
