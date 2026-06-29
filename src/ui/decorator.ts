import { setIcon, type App, type TFile } from "obsidian";
import type { SchemaResolver } from "../schema/resolver";
import type { PluginSettings } from "../settings";
import type { FieldType, ResolvedSchema, ValidationResult } from "../types";
import type { ValidationEngine } from "../validation/engine";
import { sanitizeFrontmatter } from "../validation/frontmatter";
import type { PickerModal as PickerModalType } from "./picker-modal";
import type { QuickEditModal as QuickEditModalType } from "./quick-edit-modal";
import type { showValidatorTooltip as showValidatorTooltipType } from "./validator-tooltip";

const PICKER_ATTR = "data-mv-picker";
const PICKER_CONTEXT_ATTR = "data-mv-picker-context";
const VALIDATOR_ATTR = "data-mv-validator";
const HAS_PICKER_CLASS = "mv-has-picker";

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

type NormalizedKeyMap = Map<string, string | null>;

export class PropertyDecorator {
  private observer: MutationObserver | null = null;
  private readonly app: App;
  private readonly resolver: SchemaResolver;
  private readonly engine: ValidationEngine;
  private readonly settings: PluginSettings;
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  /** Keyed by file path — avoids re-running validation when frontmatter hasn't changed */
  private readonly resultCache = new Map<string, CachedResult>();
  private lastDecoratedFilePath: string | null = null;

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
    // MutationObserver catches incremental property row additions (e.g. while
    // Obsidian is still building the properties panel). Short debounce to avoid
    // thrashing — the first paint is handled by decorateNow() called from main.ts.
    //
    // We filter mutation records before scheduling the debounce: only react when
    // a .metadata-property element was added to the DOM. This prevents unrelated
    // mutations (sidebar, graph view, menus) from triggering unnecessary decoration
    // passes on large vaults.
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (
            node.instanceOf(HTMLElement) &&
            (node.classList.contains("metadata-property") ||
              node.querySelector(".metadata-property"))
          ) {
            this.onMutation();
            return;
          }
        }
      }
    });
    this.observer.observe(activeDocument.body, { childList: true, subtree: true });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
  }

  /** Invalidate cache for a specific file path when its metadata changes. */
  invalidate(filePath: string): void {
    this.resultCache.delete(filePath);
  }

  invalidateAll(): void {
    this.resultCache.clear();
  }

  /**
   * Remove all injected picker and validator icons from the current view.
   * Call this when the schema changes so re-decoration picks up the fresh fieldDefs.
   */
  clearIcons(): void {
    activeDocument
      .querySelectorAll(`[${PICKER_ATTR}],[${VALIDATOR_ATTR}]`)
      .forEach((el) => el.remove());
    activeDocument
      .querySelectorAll<HTMLElement>(`.metadata-property.${HAS_PICKER_CLASS}`)
      .forEach((row) => row.classList.remove(HAS_PICKER_CLASS));
  }

  /**
   * Decorate immediately — call this from workspace file-open / active-leaf-change
   * events so icons appear without any debounce delay.
   */
  decorateNow(): void {
    void this.decorateAll();
  }

  private onMutation(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    // 50ms is enough to batch rapid DOM mutations without visible lag
    this.debounceTimer = window.setTimeout(() => void this.decorateAll(), 50);
  }

  async decorateAll(): Promise<void> {
    if (!this.settings.showInlineErrors) {
      this.lastDecoratedFilePath = null;
      this.clearIcons();
      return;
    }

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.lastDecoratedFilePath = null;
      this.clearIcons();
      return;
    }

    if (this.lastDecoratedFilePath !== file.path) {
      this.lastDecoratedFilePath = file.path;
      this.clearIcons();
    }

    // Shallow-copy the frontmatter so engine.validate / applyAutoFix mutations
    // never corrupt the live Obsidian metadata cache object. Without this copy,
    // subsequent reads of getFileCache(file)?.frontmatter would return mutated
    // (wrong) values, causing pickers and list modals to open with stale data.
    const frontmatter = sanitizeFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter);

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

    const normalizedSchemaKeys = this.buildNormalizedSchemaKeyMap(schema);

    const rows = Array.from(activeDocument.querySelectorAll<HTMLElement>(".metadata-property"));
    for (const row of rows) {
      const rowKey = row.getAttribute("data-property-key");
      if (!rowKey) continue;
      const schemaKey = this.resolveSchemaFieldKey(rowKey, schema, normalizedSchemaKeys);

      if (!schemaKey) {
        this.injectValidatorIcon(row, rowKey, resultMap.get(rowKey) ?? []);
        row.querySelector(`[${PICKER_ATTR}]`)?.remove();
        row.classList.remove(HAS_PICKER_CLASS);
        continue;
      }

      this.injectPickerIcon(row, schemaKey, schema, file, frontmatter);
      this.injectValidatorIcon(row, schemaKey, resultMap.get(schemaKey) ?? []);
    }
  }

  private buildNormalizedSchemaKeyMap(schema: ResolvedSchema): NormalizedKeyMap {
    const map: NormalizedKeyMap = new Map();

    for (const key of Object.keys(schema.fields)) {
      const normalized = this.normalizePropertyKey(key);
      const existing = map.get(normalized);
      if (existing === undefined) {
        map.set(normalized, key);
      } else if (existing !== key) {
        // Ambiguous normalised key: disable fallback for this token.
        map.set(normalized, null);
      }
    }

    return map;
  }

  private resolveSchemaFieldKey(
    rowKey: string,
    schema: ResolvedSchema,
    normalizedSchemaKeys: NormalizedKeyMap
  ): string | null {
    if (schema.fields[rowKey]) return rowKey;

    const normalized = this.normalizePropertyKey(rowKey);
    return normalizedSchemaKeys.get(normalized) ?? null;
  }

  private normalizePropertyKey(key: string): string {
    return key
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  private injectPickerIcon(
    row: HTMLElement,
    fieldKey: string,
    schema: ResolvedSchema,
    file: TFile,
    _frontmatter: Record<string, unknown>
  ): void {
    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) return;

    const nameEl = row.querySelector<HTMLElement>(".metadata-property-key");
    if (!nameEl) return;

    const pickerContext = `${file.path}::${schema.manifestPath}::${fieldKey}::${fieldDef.type}`;
    const existing = row.querySelector<HTMLElement>(`[${PICKER_ATTR}]`);
    if (existing?.getAttribute(PICKER_CONTEXT_ATTR) === pickerContext) return;
    existing?.remove();
    row.classList.remove(HAS_PICKER_CLASS);

    const iconName = FIELD_TYPE_ICON[fieldDef.type] ?? "square";
    const isPicker = PICKER_TYPES.has(fieldDef.type);

    const btn = row.createEl("button");
    btn.setAttribute(PICKER_ATTR, "true");
    btn.setAttribute(PICKER_CONTEXT_ATTR, pickerContext);
    btn.setAttribute("aria-label", fieldDef.type);
    btn.className = isPicker ? "mv-picker-btn clickable-icon" : "mv-type-icon clickable-icon";
    row.classList.add(HAS_PICKER_CLASS);
    setIcon(btn, iconName);

    if (isPicker) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Read fresh frontmatter at click time — avoids stale-closure bug when
        // the user edits values through the native properties panel.
        const fresh = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
          string,
          unknown
        >;
        void import("./picker-modal").then((mod: { PickerModal: typeof PickerModalType }) => {
          new mod.PickerModal(
            this.app,
            fieldKey,
            fieldDef,
            fresh[fieldKey],
            schema,
            file,
            undefined,
            this.settings.enableJsExecution
          ).open();
        });
      });
    } else if (fieldDef.type === "boolean") {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Read fresh frontmatter at click time to avoid stale-closure issues.
        const fresh = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
          string,
          unknown
        >;
        const newVal = fresh[fieldKey] !== true;
        void this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm[fieldKey] = newVal;
        });
      });
    } else {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Read fresh frontmatter at click time — same stale-closure fix as picker/boolean.
        const fresh = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
          string,
          unknown
        >;
        void import("./quick-edit-modal").then(
          (mod: { QuickEditModal: typeof QuickEditModalType }) => {
            new mod.QuickEditModal(this.app, file, fieldKey, fieldDef, fresh[fieldKey]).open();
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

    const icon = row.createSpan();
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
