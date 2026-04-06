import { setIcon, type App, type TFile } from "obsidian";
import type { FieldType, ResolvedSchema, ValidationResult } from "../types";
import type { SchemaResolver } from "../schema/resolver";
import type { ValidationEngine } from "../validation/engine";
import type { PluginSettings } from "../settings";
import type { PickerModal as PickerModalType } from "./picker-modal";
import type { ContextMenuModal as ContextMenuModalType } from "./context-menu-modal";
import type { showValidatorTooltip as showValidatorTooltipType } from "./validator-tooltip";

const PICKER_ATTR = "data-mv-picker";
const VALIDATOR_ATTR = "data-mv-validator";

/** Lucide icon name for each field type */
const FIELD_TYPE_ICON: Record<FieldType, string> = {
  text: "type",
  number: "hash",
  select: "chevron-down",
  multiselect: "list-checks",
  list: "list",
  date: "calendar",
  link: "link",
  multilink: "link-2",
  boolean: "toggle-left",
  url: "globe",
};

/** Field types that open PickerModal (have options/sources) */
const PICKER_TYPES = new Set<FieldType>(["select", "multiselect", "link", "multilink"]);

interface CachedResult {
  fmHash: string;
  results: ValidationResult[];
}

export class PropertyDecorator {
  private observer: MutationObserver | null = null;
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private readonly settings: PluginSettings;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Keyed by file path — avoids re-running validation when frontmatter hasn't changed */
  private readonly resultCache = new Map<string, CachedResult>();

  constructor(
    app: App,
    resolver: SchemaResolver,
    engine: ValidationEngine,
    settings: PluginSettings
  ) {
    this.app = app;
    this.resolver = resolver;
    this.engine = engine;
    this.settings = settings;
  }

  attach(): void {
    this.observer = new MutationObserver(() => this.onMutation());
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** Invalidate cache for a specific file path when its metadata changes */
  invalidate(filePath: string): void {
    this.resultCache.delete(filePath);
  }

  private onMutation(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.decorateAll(), 300);
  }

  async decorateAll(): Promise<void> {
    if (!this.settings.showInlineErrors) return;

    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const schema = this.resolver.resolveForNote(file, frontmatter);
    if (!schema) return;

    const fmHash = JSON.stringify(frontmatter);
    const cached = this.resultCache.get(file.path);
    let results: ValidationResult[];
    if (cached && cached.fmHash === fmHash) {
      results = cached.results;
    } else {
      results = await this.engine.validate(file, frontmatter, schema);
      this.resultCache.set(file.path, { fmHash, results });
    }

    const resultMap = new Map<string, ValidationResult[]>();
    for (const r of results) {
      const existing = resultMap.get(r.field) ?? [];
      existing.push(r);
      resultMap.set(r.field, existing);
    }

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".metadata-property"));
    for (const row of rows) {
      const key = row.getAttribute("data-property-key");
      if (!key) continue;
      const fieldDef = schema.fields[key];

      this.injectPickerIcon(row, key, schema, file, frontmatter);
      this.injectValidatorIcon(row, key, resultMap.get(key) ?? []);

      if (!fieldDef) {
        row.querySelector(`[${PICKER_ATTR}]`)?.remove();
      }
    }
  }

  private injectPickerIcon(
    row: HTMLElement,
    fieldKey: string,
    schema: ResolvedSchema,
    file: TFile,
    frontmatter: Record<string, unknown>
  ): void {
    if (row.querySelector(`[${PICKER_ATTR}]`)) return;

    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    const nameEl = row.querySelector<HTMLElement>(".metadata-property-key");
    if (!nameEl) return;

    const iconName = FIELD_TYPE_ICON[fieldDef.type] ?? "square";
    const isPicker = PICKER_TYPES.has(fieldDef.type);

    const btn = document.createElement("button");
    btn.setAttribute(PICKER_ATTR, "true");
    btn.setAttribute("aria-label", fieldDef.type);
    btn.className = isPicker ? "mv-picker-btn clickable-icon" : "mv-type-icon clickable-icon";
    setIcon(btn, iconName);

    if (isPicker) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
          new mod.PickerModal(
            this.app,
            fieldKey,
            fieldDef,
            frontmatter[fieldKey],
            schema,
            file
          ).open();
        });
      });
    } else {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void import("./context-menu-modal").then(
          (mod: { ContextMenuModal: typeof ContextMenuModalType }) => {
            new mod.ContextMenuModal(this.app, file, schema).open();
          }
        );
      });
    }

    nameEl.after(btn);
  }

  private injectValidatorIcon(
    row: HTMLElement,
    _fieldKey: string,
    results: ValidationResult[]
  ): void {
    row.querySelector(`[${VALIDATOR_ATTR}]`)?.remove();

    const errors = results.filter((r) => !r.autoFixed);
    if (errors.length === 0) return;

    const icon = document.createElement("span");
    icon.setAttribute(VALIDATOR_ATTR, "true");
    icon.className = "mv-validator-icon clickable-icon";
    setIcon(icon, "triangle-alert");

    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      void import("./validator-tooltip").then(
        (mod: { showValidatorTooltip: typeof showValidatorTooltipType }) => {
          mod.showValidatorTooltip(icon, errors);
        }
      );
    });

    row.appendChild(icon);
  }
}
