# Obsidian Metadata Validator — Design Spec

**Date:** 2026-04-05  
**Status:** Approved  
**Plugin ID:** `obsidian-metadata-validator`

---

## Overview

A plugin that replaces Metadata Menu for users who want manifest-driven schema definition, strict validation, and auto-fix — all without the complexity of a settings-heavy UI. The user defines schemas once in `manifest.md` files; the plugin enforces them everywhere.

---

## 1. Architecture

Four independent layers, each with a single responsibility:

```
┌─────────────────────────────────────────────────┐
│  UI Layer                                       │
│  MutationObserver → injects picker + validator  │
│  Modals: field picker, context menu editor      │
│  Sidebar panel, file explorer badges            │
│  Settings: schema tree, global property order   │
├─────────────────────────────────────────────────┤
│  Validation Engine                              │
│  Reads frontmatter → evaluates rules            │
│  Auto-fix: sort, default, fixed values          │
│  JS validator execution sandbox                 │
├─────────────────────────────────────────────────┤
│  Schema Resolver                                │
│  Loads manifests, builds inheritance graph      │
│  Matches notes to schemas via targeting rules   │
│  Merges inherited + override fields             │
├─────────────────────────────────────────────────┤
│  Manifest Parser                                │
│  Reads YAML frontmatter from manifest.md files  │
│  Validates manifest structure itself            │
│  Caches, watches for changes via vault events   │
└─────────────────────────────────────────────────┘
```

The Validation Engine knows nothing about the DOM. The Schema Resolver knows nothing about validation rules. Each layer is independently testable.

---

## 2. Manifest Structure

### Folder layout

```
<schemas-root>/                 ← configured in plugin settings
  base/
    manifest.md                 ← root schema
  resource/
    manifest.md                 ← extends: base (explicit) OR auto (nested in base/)
    book/
      manifest.md               ← auto-inherits from resource/ by folder nesting
      template.md               ← QuickAdd / Templater template (ignored by plugin)
    movie/
      manifest.md
  person/
    manifest.md                 ← extends: base (explicit, not nested)
```

### Inheritance rules

- **Folder nesting** → automatic inheritance from the parent folder's `manifest.md`
- **Explicit `extends`** → always takes priority over folder-based inheritance
- **Child overrides parent** → any field defined in a child replaces the parent's definition of that field entirely; non-overridden fields are inherited as-is
- **Multiple levels** → full chain is resolved (grandparent → parent → child)

### manifest.md format

The schema lives entirely in YAML frontmatter. The file body is ignored by the plugin (free for human notes, links, etc.). This makes manifests readable by DataView and any other plugin that scans frontmatter.

```yaml
---
# ── Meta ────────────────────────────────────────
name: book
description: "Books in the reading library"
priority: 10                      # higher wins on field conflicts across parallel matches
extends: "schemas/resource"       # explicit parent (overrides folder-nesting inference)

# ── Targeting ───────────────────────────────────
# Which notes belong to this type.
# All conditions are combined with op (default: AND).
target:
  op: AND                         # AND | OR
  folder: "Books/"
  tag: "#book"
  property:
    type: book

# ── Fields ──────────────────────────────────────
fields:

  status:
    type: select
    required: true
    default: "to-read"
    options:
      - value: "📖"
        label: "In progress"
      - value: "✅"
        label: "Done"
      - value: "📚"
        label: "Want to read"
      - value: "⏸"
        label: "Paused"

  author:
    type: link
    required: true
    validate_exists: true         # linked note must exist in the vault
    source:
      folder: "People/"
      property:
        type: person              # all property key=value pairs are AND-combined

  category:
    type: multilink
    source:
      tag: "#category"

  tags:
    type: multiselect
    sort: alphabetical
    source:
      js: |
        return dv.pages("#tag-source")
          .map(p => ({ value: p.file.name, label: p.label ?? p.file.name }));

  rating:
    type: number
    min: 1
    max: 5

  published:
    type: date
    format: "YYYY"

  icon:
    type: text
    fixed: "📚"                   # always auto-set to this value

  meta:
    type: multilink
    validate:
      js: |
        const related = dv.pages("#system/high/problem AND -#mark/ignore")
          .where(p =>
            Array.isArray(p.file.frontmatter.meta) &&
            current.file.frontmatter.meta
              .some(v => p.file.frontmatter.meta.includes(v))
          );
        return related.length > 0
          ? true
          : "No related problem notes found with overlapping meta values";

# ── Formatting ──────────────────────────────────
formatting:
  property_order:               # local order; overrides global setting
    - status
    - author
    - rating
    - tags
    - meta
---
```

### Supported field types

| Type | Description |
|------|-------------|
| `text` | Plain string |
| `number` | Numeric value, supports `min` / `max` |
| `select` | Single value from a list |
| `multiselect` | Multiple values from a list |
| `list` | Plain array of strings (like Obsidian `aliases`) |
| `date` | Date string, supports `format` |
| `link` | Single wikilink to another note |
| `multilink` | Array of wikilinks |
| `boolean` | true / false |
| `url` | URL string |

### `source` — unified value source

Used in both `options` (select/multiselect) and `link`/`multilink` field validation. All keys are combined with AND. For OR logic, use `js`.

| Key | Example | Effect |
|-----|---------|--------|
| `folder` | `"People/"` | Notes in this folder |
| `tag` | `"#person"` | Notes with this tag |
| `property` | `{type: person, status: active}` | Notes matching ALL frontmatter key=value pairs (AND) |
| `js` | inline JS string | Full control — return `string[]` or `{value, label}[]` |

JS context variables: `current` (TFile + frontmatter), `value` (current field value), `dv` (DataView API if installed), `app` (Obsidian App).

### Validation rules

**Auto-fix (applied silently):**
- `default` → inserted when field is empty
- `fixed` → always overwritten with this value
- `sort: alphabetical` → multiselect/list values sorted on save
- `formatting.property_order` → frontmatter key order enforced on save

**Signal only (shown as errors, never auto-corrected):**
- `required: true` and field is empty
- `options` defined and value not in the list
- `validate_exists: true` and linked note does not exist
- `source.folder` / `source.tag` / `source.property` and linked note doesn't match source
- `min` / `max` violated
- Custom `validate.js` returns a string (the string is the error message)

---

## 3. Schema Resolver

### Discovery

On plugin load, the resolver scans the configured `schemas-root` folder recursively for all `manifest.md` files. It watches this folder for changes via `vault.on("modify")` and `vault.on("create")` / `vault.on("delete")`. No manual refresh required.

### Inheritance graph

After loading all manifests, the resolver builds a directed acyclic graph:
1. Parse all `extends` fields (explicit)
2. For manifests without `extends`, check if parent folder contains a `manifest.md` → implicit parent
3. Detect cycles → report as manifest error, skip the offending manifest
4. Resolve full merged schema for each manifest (depth-first, child overrides parent)

### Note → schema matching

For a given note, the resolver:
1. Finds all manifests whose `target` matches the note
2. If exactly one matches → use it
3. If multiple match → apply `priority` field; higher priority wins on conflicting fields, non-conflicting fields are merged
4. If no manifest matches → note is unmanaged, plugin does nothing to it

Targeting evaluation: `folder` checks `file.path.startsWith(folder)`, `tag` checks `file.tags`, `property` checks frontmatter key=value equality. `op: OR` means any condition suffices.

---

## 4. Validation Engine

### Timing

All modes are independently toggleable in settings. Defaults:

| Mode | Default | Trigger |
|------|---------|---------|
| Live | ON | Frontmatter changes (debounced 300ms) |
| On-save | ON | `vault.on("modify")` |
| On-open | ON | `workspace.on("file-open")` |
| Background scan | ON | Every 5 minutes (configurable) |

### Result model

```typescript
interface ValidationResult {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
  rule: string;          // e.g. "required", "options", "validate.js"
  manifestPath: string;  // which manifest defined this rule
  autoFixed: boolean;    // whether the engine already corrected it
}
```

### JS validator execution

JS code from `validate.js` is executed via `new Function()` with an injected context object. No network access. Execution is wrapped in try/catch — if the code throws, the error message is shown as the validation error. DataView access is optional: if DataView is not installed, `dv` is `undefined` and the code should handle that gracefully.

---

## 5. UI Layer

### Property panel decoration

The plugin uses a `MutationObserver` on the properties panel container. When a property row is added or updated:
1. Inject a **picker icon** immediately after the property name label
2. Inject a **validator icon** at the far right of the row

Both icons are injected as DOM elements with `data-field` attributes for targeted updates.

```
[property name] [⊞ picker] [Obsidian native input] [⚠ or ✓ validator]
```

Obsidian's own type icon (≡ 🔗 📅) and Obsidian's native validator (⚠ triangle) are hidden via CSS injection when the corresponding settings are enabled (both ON by default).

### Picker modal

Opens when the picker icon is clicked. Shows:

- Field name + type + required status
- Search input (fuzzy search over options)
- List of values: `{label} · {value}` if key-value, plain string otherwise
- Current invalid value shown highlighted in red with "not in allowed list" note
- Footer: source manifest path + inheritance chain (e.g. `base → resource → book`)
- Clicking a value writes it to frontmatter via `app.fileManager.processFrontMatter()`

For `link`/`multilink` fields, the list shows matching notes resolved from `source`. Clicking a note inserts a wikilink.

### Validator tooltip

Shown when the validator icon is clicked (or hovered). A small popover (not a modal):

- Error message
- Rule name and manifest path
- "Open manifest →" link
- Closes on click-outside or Escape

### Context menu editor

Registered via `app.workspace.on("file-menu")`. Menu item: **"Edit properties"**. Opens a full modal showing all fields defined in the matching manifest, with current values, pickers, and validation state. Allows editing any field without opening the note.

### Sidebar panel

A leaf view showing all validation issues for the currently open note. Updates live. Shows field name, severity, message. Clicking a row focuses that field in the properties panel.

### File explorer badges

A small colored dot next to file names in the file tree. Red = at least one error, yellow = warnings only, green = all valid. Toggled in settings (ON by default). Updated on background scan to avoid per-keystroke overhead.

### Global validation report

Command palette command: **"Show vault validation report"**. Opens a modal listing all notes with issues, grouped by type. Filterable by severity and manifest type.

---

## 6. Bases integration

No icons are injected into Bases table cells (too many cells → performance). Instead:

- A `MutationObserver` watches for Bases cell edit events (the moment a cell becomes editable)
- When a cell becomes editable and the column maps to a field that has a manifest, the native input is intercepted and the **picker modal** is shown instead
- The modal writes directly to frontmatter; Bases re-reads and updates the cell
- Bases columns continue to display native values — no visual changes to table rendering

---

## 7. Settings

### General
- `schemasRoot`: path to manifest folder (default: `schemas/`)
- `enableLiveValidation`: boolean (default: true)
- `enableOnSave`: boolean (default: true)
- `enableOnOpen`: boolean (default: true)
- `backgroundScanInterval`: minutes (default: 5)

### UI
- `hideObsidianTypeIcon`: hide native property type icon (default: true)
- `hideObsidianValidator`: hide native Obsidian validator icon (default: true)
- `showInlineErrors`: show validator icon in properties panel (default: true)
- `showSidebarPanel`: show per-note issue panel (default: true)
- `showFileExplorerBadges`: show dots in file tree (default: true)

### Properties
- `globalPropertyOrder`: ordered list of property names applied as default order across all types
- Manifest-level `formatting.property_order` overrides this per type

### Schema tree view
- Visual tree of all discovered manifests showing inheritance hierarchy
- Each node: manifest name, target summary, field count
- Click → opens the manifest file in the editor
- Collapsed by default, expands per branch

---

## 8. Performance considerations

- **MutationObserver debounce**: 300ms on frontmatter changes before triggering validation
- **Schema cache**: resolved merged schemas are cached; invalidated only when a manifest file changes
- **Validation result cache**: per-file, invalidated on file modify
- **Background scan**: runs on idle (after 30s of no vault activity)
- **JS validator timeout**: 2000ms hard limit; exceeded → shown as error
- **Bases**: no per-cell injection; only activates on interaction
- **File explorer badges**: updated by background scan only, not on every keystroke
- Plugin startup: manifest scan only, validation deferred until first file open

---

## 9. File structure

```
src/
  main.ts                     # plugin lifecycle only
  settings.ts                 # settings interface + defaults
  types.ts                    # shared TypeScript interfaces

  manifest/
    parser.ts                 # reads manifest.md YAML frontmatter
    watcher.ts                # vault event listener for manifest changes
    cache.ts                  # manifest cache

  schema/
    resolver.ts               # inheritance graph + note→schema matching
    merger.ts                 # merges parent + child field definitions
    source-resolver.ts        # evaluates source: {folder/tag/property/js}

  validation/
    engine.ts                 # runs rules, produces ValidationResult[]
    rules/
      required.ts
      options.ts
      link-exists.ts
      link-source.ts
      number-range.ts
      js-validator.ts         # executes validate.js with sandboxed context
    auto-fix.ts               # applies default, fixed, sort

  ui/
    decorator.ts              # MutationObserver, icon injection
    picker-modal.ts           # field value picker
    context-menu-modal.ts     # full property editor from context menu
    validator-tooltip.ts      # small error popover
    sidebar-panel.ts          # per-note issues leaf view
    explorer-badges.ts        # file tree dot indicators
    validation-report.ts      # global vault report modal
    schema-tree.ts            # settings: inheritance tree view
    css-injector.ts           # hides Obsidian native type icons + validator
```

---

## 10. Out of scope (first release)

- Syncing or exporting schemas
- Network requests of any kind
- Auto-generating manifests from existing notes
- Custom themes / styling for the picker modal
- Multi-vault support
