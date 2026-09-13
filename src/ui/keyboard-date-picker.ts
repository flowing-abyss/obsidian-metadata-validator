import { moment } from "../utils/dates";
import { setIcon } from "obsidian";
import type { KeyboardPropertyItem } from "../types";

export function dateSuggestions(format: string): KeyboardPropertyItem[] {
  return [
    { days: 0, label: "Today" },
    { days: 1, label: "Tomorrow" },
    { days: 2, label: "In two days" },
    { days: 7, label: "In one week" },
  ].map(({ days, label }) => ({
    kind: "action",
    action: "date",
    label,
    value: moment().add(days, "days").format(format),
    description: moment().add(days, "days").format("ddd, D MMM YYYY"),
  }));
}

/** An inline calendar; the parent prompt and its search field stay mounted. */
export class KeyboardDatePicker {
  readonly el: HTMLElement;
  private day = moment().startOf("day");
  private month = this.day.clone().startOf("month");
  private selected = "";
  private format = "YYYY-MM-DD";

  constructor(
    parent: HTMLElement,
    private readonly choose: (value: string) => void
  ) {
    this.el = parent.createDiv("mv-keyboard-calendar mv-hidden");
    this.el.setAttribute("aria-label", "Choose a date");
  }

  get visible(): boolean {
    return !this.el.hasClass("mv-hidden");
  }

  hide(): void {
    this.el.addClass("mv-hidden");
  }

  show(value: string, format: string): void {
    this.format = format;
    const parsed = moment(value, format, true);
    this.day = parsed.isValid() ? parsed : moment().startOf("day");
    this.selected = parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
    this.month = this.day.clone().startOf("month");
    this.el.removeClass("mv-hidden");
    this.render();
    this.focusDay();
  }

  private focusDay(): void {
    this.el
      .querySelector<HTMLButtonElement>(`[data-date="${this.day.format("YYYY-MM-DD")}"]`)
      ?.focus();
  }

  /** Called by the prompt's scope, before native suggestion navigation. */
  handleKey(key: string): boolean {
    if (!this.visible || !this.el.contains(this.el.ownerDocument.activeElement)) return false;
    const active = this.el.ownerDocument.activeElement as HTMLElement;
    if (key === "Enter" || key === " ") {
      active.click();
      return true;
    }
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (key in offsets) this.day.add(offsets[key], "days");
    else if (key === "PageUp" || key === "PageDown")
      this.day.add(key === "PageUp" ? -1 : 1, "months");
    else return false;
    this.month = this.day.clone().startOf("month");
    this.render();
    this.focusDay();
    return true;
  }

  private render(): void {
    this.el.empty();
    const header = this.el.createDiv("mv-calendar-header");
    const previous = header.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Previous month", type: "button" },
    });
    setIcon(previous, "chevron-left");
    header.createSpan({ text: this.month.format("MMMM YYYY"), attr: { "aria-live": "polite" } });
    const next = header.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Next month", type: "button" },
    });
    setIcon(next, "chevron-right");
    for (const [button, amount] of [
      [previous, -1],
      [next, 1],
    ] as const) {
      button.addEventListener("click", () => {
        this.month.add(amount, "months");
        this.day = this.month.clone();
        this.render();
        this.el
          .querySelector<HTMLButtonElement>(
            `[aria-label="${amount === -1 ? "Previous month" : "Next month"}"]`
          )
          ?.focus();
      });
    }
    const grid = this.el.createDiv("mv-calendar-grid");
    const start = this.month.clone().startOf("week");
    for (let i = 0; i < 7; i++)
      grid.createSpan({
        cls: "mv-calendar-weekday",
        text: start.clone().add(i, "days").format("dd"),
      });
    const end = this.month.clone().endOf("month").endOf("week");
    for (const date = start.clone(); date.isSameOrBefore(end, "day"); date.add(1, "day")) {
      const iso = date.format("YYYY-MM-DD");
      const value = date.format(this.format);
      const button = grid.createEl("button", {
        cls: "mv-calendar-day",
        text: date.format("D"),
        attr: {
          type: "button",
          "data-date": iso,
          "aria-label": date.format("dddd, D MMMM YYYY"),
          "aria-pressed": String(iso === this.selected),
          tabindex: date.isSame(this.day, "day") ? "0" : "-1",
        },
      });
      button.toggleClass("mv-calendar-outside", !date.isSame(this.month, "month"));
      if (date.isSame(moment(), "day")) button.setAttribute("aria-current", "date");
      button.addEventListener("click", () => this.choose(value));
    }
  }
}
