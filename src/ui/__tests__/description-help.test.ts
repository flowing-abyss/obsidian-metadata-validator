import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionHelp } from "../description-help";

describe("DescriptionHelp", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("supports pinned help, Escape, and cleanup without interpreting HTML", () => {
    const help = new DescriptionHelp();
    help.load();
    const button = document.body.createEl("button", { text: "Status" });
    help.bind(button, "<b>A stage.</b>", "Status", true);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const popup = document.querySelector(".mv-description-popover");
    expect(popup?.textContent).toBe("Status<b>A stage.</b>");
    expect(popup?.querySelector("b")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".mv-description-popover")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    help.unload();
    expect(document.querySelector(".mv-description-popover")).toBeNull();
    expect(document.querySelector(".mv-description-sr")).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    button.click();
    expect(document.querySelector(".mv-description-popover")).toBeNull();
  });

  it("cancels delayed help when the view clears and replaces old descriptions", () => {
    vi.useFakeTimers();
    const help = new DescriptionHelp();
    help.load();
    const button = document.body.createEl("button");
    help.bind(button, "Old description.");
    button.dispatchEvent(new MouseEvent("mouseenter"));
    help.clear();
    vi.runAllTimers();
    expect(document.querySelector(".mv-description-popover")).toBeNull();
    help.bind(button, "New description.");
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.querySelector(".mv-description-popover")?.textContent).toBe("New description.");
    help.bind(button, " ");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(document.querySelector(".mv-description-popover")).toBeNull();
    help.unload();
  });

  it("dismisses help in its own document and releases handlers after the last binding", () => {
    const other = document.implementation.createHTMLDocument("Pop-out");
    const help = new DescriptionHelp();
    help.load();
    const first = other.body.createEl("button");
    const second = other.body.createEl("button");
    const remove = vi.spyOn(other, "removeEventListener");
    help.bind(first, "First.", undefined, true);
    help.bind(second, "Second.", undefined, true);
    first.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(other.querySelector(".mv-description-popover")).not.toBeNull();
    other.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(other.querySelector(".mv-description-popover")).toBeNull();

    help.unbind(first);
    expect(remove).not.toHaveBeenCalled();
    second.click();
    other.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(other.querySelector(".mv-description-popover")).toBeNull();
    second.click();
    other.dispatchEvent(new Event("scroll"));
    expect(other.querySelector(".mv-description-popover")).toBeNull();
    help.unbind(second);
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual([
      "keydown",
      "pointerdown",
      "scroll",
    ]);
    help.unload();
  });

  it.each(["clear", "unload"] as const)(
    "cancels the owner's timer on %s and ignores an already queued callback",
    (operation) => {
      const other = document.implementation.createHTMLDocument("Pop-out");
      let callback = () => {};
      const owner = Object.assign(new EventTarget(), {
        setTimeout: vi.fn((fn: () => void) => {
          callback = fn;
          return 71;
        }),
        clearTimeout: vi.fn(),
      });
      Object.defineProperty(other, "defaultView", { value: owner });
      const help = new DescriptionHelp();
      help.load();
      const button = other.body.createEl("button");
      help.bind(button, "Delayed.");
      button.dispatchEvent(new MouseEvent("mouseenter"));
      expect(owner.setTimeout).toHaveBeenCalledWith(expect.any(Function), 350);
      help[operation]();
      expect(owner.clearTimeout).toHaveBeenCalledWith(71);
      callback();
      expect(other.querySelector(".mv-description-popover")).toBeNull();
      expect(button.hasAttribute("aria-describedby")).toBe(false);
      help.unload();
    }
  );
});
