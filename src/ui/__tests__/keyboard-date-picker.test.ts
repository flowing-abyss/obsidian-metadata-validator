import { afterEach, describe, expect, it, vi } from "vitest";
import { dateSuggestions, KeyboardDatePicker } from "../keyboard-date-picker";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("keyboard dates", () => {
  it("offers nearby calendar dates in the field format across year boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30));
    expect(
      dateSuggestions("DD/MM/YYYY").map((item) => item.kind === "action" && item.value)
    ).toEqual(["31/12/2026", "01/01/2027", "02/01/2027", "07/01/2027"]);
  });
  it("opens on the stored date and picks a day with the requested format", () => {
    const choose = vi.fn();
    const picker = new KeyboardDatePicker(document.body, choose);
    picker.show("29/02/2028", "DD/MM/YYYY");
    expect(document.activeElement?.getAttribute("data-date")).toBe("2028-02-29");
    expect(picker.el.querySelector('[aria-pressed="true"]')?.getAttribute("data-date")).toBe(
      "2028-02-29"
    );
    picker.el.querySelector<HTMLButtonElement>('[data-date="2028-02-15"]')!.click();
    expect(choose).toHaveBeenCalledWith("15/02/2028");
  });
  it("moves across months using arrows and selects with Enter", () => {
    const choose = vi.fn();
    const picker = new KeyboardDatePicker(document.body, choose);
    picker.show("2026-12-31", "YYYY-MM-DD");
    expect(picker.handleKey("ArrowRight")).toBe(true);
    expect(document.activeElement?.getAttribute("data-date")).toBe("2027-01-01");
    expect(picker.handleKey("ArrowDown")).toBe(true);
    expect(picker.handleKey("Enter")).toBe(true);
    expect(choose).toHaveBeenCalledWith("2027-01-08");
    picker.hide();
    expect(picker.handleKey("ArrowRight")).toBe(false);
  });
  it("changes months by mouse without saving a value", () => {
    const choose = vi.fn();
    const picker = new KeyboardDatePicker(document.body, choose);
    picker.show("2026-12-31", "YYYY-MM-DD");
    picker.el.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
    expect(picker.el.textContent).toContain("January 2027");
    expect(choose).not.toHaveBeenCalled();
  });
});
