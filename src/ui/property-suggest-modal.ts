import { moment } from "../utils/dates";
import { App, FuzzySuggestModal, Notice, Scope, setIcon } from "obsidian";
import type { EventRef, FuzzyMatch, TFile } from "obsidian";
import type { KeyboardPropertyItem, PropertySuggestion, ResolvedSchema } from "../types";
import { descriptionText } from "../utils/descriptions";
import { propertyValueText } from "../utils/property-values";
import { loadFieldOptions } from "../schema/field-options";
import { propertySuggestions } from "./property-suggestions";
import { KeyboardPropertyDraft } from "./keyboard-property-draft";
import { KeyboardDatePicker, dateSuggestions } from "./keyboard-date-picker";
import { sectionSuggestions, matchKeyboardSuggestions } from "./keyboard-property-sections";
import { renderKeyboardProperty } from "./keyboard-property-renderer";

/** Every property and value editor lives in the same native prompt and scope. */
export class PropertySuggestModal extends FuzzySuggestModal<KeyboardPropertyItem> {
  private draft: KeyboardPropertyDraft | null = null;
  private readonly navigation: HTMLElement;
  private readonly title: HTMLElement;
  private readonly calendar: KeyboardDatePicker;
  private readonly calendarScope: Scope;
  private readonly localValues = new Map<string, unknown>();
  private rootQuery = "";
  private loading = false;
  private failure = "";
  private saving = false;
  private closed = false;
  private closeAfterSave = false;
  private cacheEvent: EventRef | null = null;
  private cacheRevision = 0;

  constructor(
    app: App,
    private readonly file: TFile,
    private readonly schema: ResolvedSchema,
    private readonly enableJs = false
  ) {
    super(app);
    this.modalEl.addClass("mv-property-suggest-modal");
    this.navigation = this.modalEl.createDiv("mv-property-navigation mv-hidden");
    (this.inputEl.closest(".prompt-input-container") ?? this.inputEl).before(this.navigation);
    const back = this.navigation.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": "Back to properties", title: "Back (esc)" },
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => void this.back());
    this.title = this.navigation.createSpan("mv-property-editor-title");
    this.calendar = new KeyboardDatePicker(this.modalEl, (value) => {
      this.inputEl.value = value;
      void this.finish();
    });
    this.resultContainerEl.before(this.calendar.el);
    this.inputEl.addEventListener(
      "input",
      () => {
        if (this.calendar.visible && this.inputEl.ownerDocument.activeElement === this.inputEl) {
          this.hideCalendar();
        }
      },
      { capture: true }
    );
    // A child scope overrides Escape without replacing native arrow-key navigation.
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", () => {
      if (this.calendar.visible) {
        this.hideCalendar();
        this.refresh(this.inputEl.value);
      } else if (this.draft) void this.back();
      else this.close();
      return false;
    });
    this.calendarScope = new Scope(this.scope);
    for (const key of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Enter",
      " ",
    ]) {
      this.calendarScope.register([], key, () =>
        this.calendar.handleKey(key) ? false : undefined
      );
    }
    this.scope.register(["Alt"], "ArrowLeft", () => {
      void this.back();
      return false;
    });
    this.scope.register(["Mod"], "Enter", () => {
      if (!this.calendar.handleKey("Enter") && this.draft) void this.finish();
      return false;
    });
    this.showProperties();
  }

  onOpen(): void {
    void super.onOpen();
    this.cacheEvent = this.app.metadataCache.on("changed", (changedFile) => {
      if (changedFile.path !== this.file.path) return;
      this.cacheRevision++;
      this.localValues.clear();
    });
  }

  getItems(): KeyboardPropertyItem[] {
    if (!this.draft)
      return propertySuggestions(this.schema).map((property) => ({
        kind: "property",
        property,
        label: property.label,
        description: descriptionText(property.field.description),
      }));
    if (this.fixedEditing)
      return [
        {
          kind: "action",
          action: "message",
          label: "Fixed value",
          description: propertyValueText(this.draft.property.field.fixed) || "Empty",
        },
      ];
    if (this.loading) return [{ kind: "action", action: "message", label: "Loading options…" }];
    if (this.failure)
      return [
        {
          kind: "action",
          action: "message",
          label: "Options unavailable",
          description: this.failure,
        },
      ];
    if (this.dateEditing) {
      const items = dateSuggestions(this.dateFormat);
      items.push({ kind: "action", action: "calendar", label: "Choose on calendar…" });
      if (this.draft.value)
        items.push({ kind: "action", action: "date", label: "Clear date", value: "" });
      return items;
    }
    if (this.draft.scalar)
      return [
        {
          kind: "action",
          action: "save",
          label: "Save value",
          description: "Enter to save. Escape to cancel.",
        },
      ];
    const items: KeyboardPropertyItem[] = this.draft.choices.map((option) => ({
      kind: "option",
      option,
      label: option.label ?? option.value,
      description: descriptionText(option.description),
    }));
    if (!this.draft.multiple && this.draft.selected.size)
      items.push({ kind: "action", action: "clear", label: "Clear value" });
    return items;
  }

  getItemText(item: KeyboardPropertyItem): string {
    return [
      item.label,
      item.description,
      item.kind === "property"
        ? item.property.key
        : item.kind === "option"
          ? item.option.value
          : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  getSuggestions(query: string): FuzzyMatch<KeyboardPropertyItem>[] {
    if (this.fixedEditing)
      return this.getItems().map((item) => ({ item, match: { score: 0, matches: [] } }));
    if (this.dateEditing) {
      if (this.calendar.visible) return [];
      const parsed = moment(query.trim(), this.dateFormat, true);
      if (parsed.isValid()) {
        return [
          {
            item: {
              kind: "action",
              action: "save",
              label: "Save date",
              description: parsed.format("ddd, D MMM YYYY"),
            },
            match: { score: 0, matches: [] },
          },
          ...this.getItems().map((item) => ({ item, match: { score: 0, matches: [] } })),
        ];
      }
      return super.getSuggestions(query);
    }
    if (this.draft?.scalar || this.loading || this.failure)
      return this.getItems().map((item) => ({ item, match: { score: 0, matches: [] } }));
    const matches = matchKeyboardSuggestions(this.getItems(), query, (item) =>
      this.getItemText(item)
    );
    if (this.draft?.freeList && query.trim() && !this.draft.selected.has(query.trim())) {
      matches.unshift({
        item: {
          kind: "action",
          action: "add",
          value: query.trim(),
          label: `Add “${query.trim()}”`,
        },
        match: { score: 0, matches: [] },
      });
    }
    if (!this.draft) return sectionSuggestions(matches);
    return !this.draft.freeList ? sectionSuggestions(matches, this.draft.selected) : matches;
  }

  private hideCalendar(): void {
    if (this.calendar.visible) this.app.keymap.popScope(this.calendarScope);
    this.calendar.hide();
  }

  private get fixedEditing(): boolean {
    return !!this.draft && this.draft.property.field.fixed !== undefined;
  }

  private get dateEditing(): boolean {
    return !!this.draft?.scalar && this.draft.property.field.type === "date";
  }

  private get dateFormat(): string {
    return this.draft?.property.field.format || "YYYY-MM-DD";
  }

  renderSuggestion(item: FuzzyMatch<KeyboardPropertyItem>, el: HTMLElement): void {
    renderKeyboardProperty(
      item,
      el,
      item.item.kind === "option" && !!this.draft?.selected.has(item.item.option.value)
    );
  }

  // SuggestModal normally closes after selection. Keep this same modal mounted.
  selectSuggestion(item: FuzzyMatch<KeyboardPropertyItem>): void {
    this.onChooseItem(item.item);
  }

  onChooseItem(item: KeyboardPropertyItem): void {
    if (this.saving || this.loading || this.closed) return;
    if (item.kind === "property") {
      void this.openProperty(item.property);
      return;
    }
    if (!this.draft || this.fixedEditing) return;
    if (item.kind === "option") {
      if (item.pinned && !this.draft.multiple) this.draft.clear();
      else this.draft.toggle(item.option);
      if (!this.draft.multiple) {
        void this.finish();
        return;
      }
      if (this.draft.freeList) this.refresh("");
      else {
        // Keep keyboard focus on the same copy while the selected section updates.
        const scroll = this.resultContainerEl.scrollTop;
        this.refresh(this.inputEl.value);
        const rows = Array.from(
          this.resultContainerEl.querySelectorAll<HTMLElement>("[data-value]")
        );
        const row =
          rows.find(
            (row) =>
              row.dataset.value === item.option.value &&
              row.dataset.copy === (item.pinned ? "selected" : "all")
          ) ?? rows.find((row) => row.dataset.copy === (item.pinned ? "selected" : "all"));
        row?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        this.resultContainerEl.scrollTop = scroll;
      }
    } else if (item.action === "add") {
      this.draft.add(item.value ?? "");
      this.refresh("");
    } else if (item.action === "clear") {
      this.draft.clear();
      void this.finish();
    } else if (item.action === "date") {
      this.inputEl.value = item.value ?? "";
      void this.finish();
    } else if (item.action === "calendar") {
      this.app.keymap.pushScope(this.calendarScope);
      this.calendar.show(
        moment(this.inputEl.value, this.dateFormat, true).isValid()
          ? this.inputEl.value
          : propertyValueText(this.draft.value),
        this.dateFormat
      );
      this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (item.action === "save") void this.finish();
  }

  private refresh(query: string): void {
    this.inputEl.value = query;
    this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    this.inputEl.focus();
  }

  private showProperties(): void {
    this.draft = null;
    this.hideCalendar();
    this.loading = false;
    this.failure = "";
    this.navigation.addClass("mv-hidden");
    this.setPlaceholder(`Properties: ${this.file.basename}`);
    this.inputEl.setAttribute("aria-label", `Search properties of ${this.file.basename}`);
    this.emptyStateText = "No matching properties.";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to edit" },
      { command: "esc", purpose: "to close" },
    ]);
    this.refresh(this.rootQuery);
  }

  private async openProperty(property: PropertySuggestion): Promise<void> {
    this.rootQuery = this.inputEl.value;
    const value: unknown = this.localValues.has(property.key)
      ? this.localValues.get(property.key)
      : this.app.metadataCache.getFileCache(this.file)?.frontmatter?.[property.key];
    const draft = new KeyboardPropertyDraft(this.app, this.file, property, value);
    this.draft = draft;
    this.title.textContent = property.label;
    this.navigation.removeClass("mv-hidden");
    if (this.fixedEditing) {
      this.setPlaceholder("Fixed property");
      this.inputEl.setAttribute("aria-label", property.label);
      this.setInstructions([{ command: "esc", purpose: "back to properties" }]);
      this.refresh("");
      return;
    }
    this.setPlaceholder(
      draft.scalar
        ? property.field.type === "date"
          ? property.field.format || "YYYY-MM-DD"
          : "Enter value…"
        : draft.freeList
          ? "Add or find a value…"
          : "Search values…"
    );
    this.inputEl.setAttribute("aria-label", property.label);
    this.emptyStateText = this.dateEditing
      ? `Enter a date as ${this.dateFormat}, or search for today or tomorrow.`
      : draft.freeList
        ? "Type a value to add it."
        : "No matching values.";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: draft.multiple ? "to toggle" : "to save" },
      { command: "esc", purpose: "back to properties" },
    ]);
    if (property.field.type === "boolean")
      draft.options = [
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ];
    this.loading = !draft.scalar && !draft.freeList && property.field.type !== "boolean";
    this.refresh(draft.scalar ? propertyValueText(value) : "");
    if (draft.scalar) this.inputEl.select();
    if (!this.loading) return;
    try {
      const result = await loadFieldOptions(property.field, this.app, this.file, this.enableJs);
      if (this.closed || this.draft !== draft) return;
      draft.options = result.options;
      if (result.status !== "resolved")
        this.failure =
          result.status === "disabled"
            ? "JavaScript option sources are disabled in plugin settings."
            : "Could not load options from this source.";
    } catch (error) {
      if (this.closed || this.draft !== draft) return;
      console.error("[MetadataValidator] Could not load property options", error);
      this.failure = "Could not load options from this source.";
    }
    this.loading = false;
    this.refresh(this.inputEl.value);
  }

  private async back(): Promise<void> {
    if (this.saving || !this.draft) return;
    if (this.draft.dirty && !this.draft.scalar) await this.finish();
    else this.showProperties();
  }

  private async finish(close = false): Promise<void> {
    if (!this.draft || this.fixedEditing || this.saving || this.loading || this.failure) return;
    this.saving = true;
    try {
      const draft = this.draft;
      const revision = this.cacheRevision;
      const value = await draft.save(this.inputEl.value);
      if (this.closed) return;
      if (revision === this.cacheRevision) this.localValues.set(draft.property.key, value);
      if (close || this.closeAfterSave) {
        this.closed = true;
        super.close();
      } else this.showProperties();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not save property.");
    } finally {
      this.saving = false;
      this.closeAfterSave = false;
    }
  }

  close(): void {
    if (this.saving) {
      this.closeAfterSave = true;
      return;
    }
    if (!this.closed && this.draft?.dirty && !this.draft.scalar) {
      void this.finish(true);
      return;
    }
    this.closed = true;
    super.close();
  }

  /** Teardown cannot wait for storage when the command is replaced or plugin unloads. */
  dispose(): void {
    const draft = this.draft;
    const savePendingDraft = !this.closed && !this.saving && draft?.dirty && !draft.scalar;
    this.closed = true;
    super.close();
    if (savePendingDraft)
      void draft.save().catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : "Could not save property.");
      });
  }

  onClose(): void {
    if (this.cacheEvent) {
      this.app.metadataCache.offref(this.cacheEvent);
      this.cacheEvent = null;
    }
    this.localValues.clear();
    this.hideCalendar();
    this.closed = true;
    super.onClose();
  }
}
