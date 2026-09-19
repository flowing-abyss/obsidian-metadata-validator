import { Component } from "obsidian";
import { descriptionText } from "../utils/descriptions";

let nextDescriptionId = 0;

/** Shared plain-text help for mouse, keyboard and touch. Owned by the view lifecycle. */
export class DescriptionHelp extends Component {
  private bindings = new Map<HTMLElement, () => void>();
  private popup: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private pinned = false;
  private active = false;
  private timer: { window: Window; id: number } | null = null;
  private documents = new Map<Document, { owner: Component; references: number }>();

  bind(target: HTMLElement, raw: unknown, heading?: string, pinOnClick = false): void {
    this.unbind(target);
    if (!this.active) return;
    const text = descriptionText(raw);
    if (!text) return;

    const child = new Component();
    this.addChild(child);
    this.retainDocument(target.ownerDocument);
    const id = `mv-description-${++nextDescriptionId}`;
    const original = target.getAttribute("aria-describedby");
    const accessibleText = target.createSpan({ cls: "mv-description-sr", text, attr: { id } });
    target.after(accessibleText);
    target.setAttribute("aria-describedby", [original, id].filter(Boolean).join(" "));
    target.addClass("mv-has-description");
    const hideLater = () => {
      this.schedule(
        target,
        () => {
          if (!this.pinned) this.hide();
        },
        160
      );
    };
    const show = () => this.show(target, text, heading, hideLater);
    child.registerDomEvent(target, "mouseenter", () => {
      if (this.pinned) return;
      this.schedule(target, show, 350);
    });
    child.registerDomEvent(target, "mouseleave", hideLater);
    child.registerDomEvent(target, "focusin", () => {
      if (!this.pinned) show();
    });
    child.registerDomEvent(target, "focusout", hideLater);
    if (pinOnClick) {
      child.registerDomEvent(target, "click", (event) => {
        event.stopPropagation();
        if (this.pinned && this.anchor === target) {
          this.hide();
        } else {
          this.hide();
          show();
          this.pinned = true;
          target.setAttribute("aria-expanded", "true");
        }
      });
      target.setAttribute("aria-expanded", "false");
    }
    child.register(() => {
      if (this.anchor === target) this.hide();
      this.cancelTimer();
      this.releaseDocument(target.ownerDocument);
      accessibleText.remove();
      if (original === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", original);
      target.removeClass("mv-has-description");
      if (pinOnClick) target.removeAttribute("aria-expanded");
    });
    this.bindings.set(target, () => this.removeChild(child));
  }

  unbind(target: HTMLElement): void {
    this.bindings.get(target)?.();
    this.bindings.delete(target);
  }

  clear(): void {
    this.hide();
    for (const dispose of this.bindings.values()) dispose();
    this.bindings.clear();
  }

  prune(): void {
    for (const target of this.bindings.keys()) {
      if (!target.isConnected) this.unbind(target);
    }
  }

  dismiss(): void {
    this.hide();
  }

  onload(): void {
    this.active = true;
  }

  onunload(): void {
    this.active = false;
    this.clear();
  }

  private retainDocument(doc: Document): void {
    const existing = this.documents.get(doc);
    if (existing) {
      existing.references++;
      return;
    }
    const owner = this.addChild(new Component());
    this.documents.set(doc, { owner, references: 1 });
    const ownsPopup = () => this.popup?.ownerDocument === doc;
    owner.registerDomEvent(
      doc,
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !ownsPopup()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.hide();
      },
      true
    );
    owner.registerDomEvent(doc, "pointerdown", (event) => {
      if (!ownsPopup()) return;
      const target = event.target as Node;
      if (!this.popup?.contains(target) && !this.anchor?.contains(target)) this.hide();
    });
    owner.registerDomEvent(
      doc,
      "scroll",
      (event) => {
        if (ownsPopup() && !this.popup?.contains(event.target as Node)) this.hide();
      },
      true
    );
    if (doc.defaultView)
      owner.registerDomEvent(doc.defaultView, "resize", () => {
        if (ownsPopup()) this.hide();
      });
  }

  private releaseDocument(doc: Document): void {
    const entry = this.documents.get(doc);
    if (!entry || --entry.references > 0) return;
    this.removeChild(entry.owner);
    this.documents.delete(doc);
  }

  private schedule(target: HTMLElement, callback: () => void, delay: number): void {
    this.cancelTimer();
    const win = target.ownerDocument.defaultView;
    if (!win || !this.active) return;
    const timer = { window: win, id: 0 };
    this.timer = timer;
    timer.id = win.setTimeout(() => {
      if (this.timer !== timer || !this.active || !this.bindings.has(target)) return;
      this.timer = null;
      callback();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer) this.timer.window.clearTimeout(this.timer.id);
    this.timer = null;
  }

  private show(
    target: HTMLElement,
    text: string,
    heading: string | undefined,
    hideLater: () => void
  ): void {
    if (!this.active || !this.bindings.has(target) || !target.isConnected || this.pinned) return;
    this.hide();
    this.anchor = target;
    const doc = target.ownerDocument;
    const popup = doc.body.createDiv({ cls: "mv-description-popover", attr: { role: "tooltip" } });
    this.popup = popup;
    if (heading) popup.createDiv({ cls: "mv-description-heading", text: heading });
    popup.createDiv({ cls: "mv-description-text", text });
    popup.addEventListener("mouseenter", () => this.cancelTimer());
    popup.addEventListener("mouseleave", hideLater);
    const rect = target.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const left = Math.max(8, Math.min(rect.left, width - bounds.width - 8));
    const top =
      rect.top - bounds.height - 8 >= 8
        ? rect.top - bounds.height - 8
        : Math.min(rect.bottom + 8, Math.max(8, height - bounds.height - 8));
    popup.style.setProperty("left", `${left}px`);
    popup.style.setProperty("top", `${top}px`);
  }

  private hide(): void {
    this.cancelTimer();
    if (this.pinned) this.anchor?.setAttribute("aria-expanded", "false");
    this.popup?.remove();
    this.popup = null;
    this.anchor = null;
    this.pinned = false;
  }
}
