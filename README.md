# Metadata Validator

[![Available in Obsidian](https://img.shields.io/badge/Available%20in%20Obsidian-7C3AED?logo=obsidian&logoColor=white&style=flat-square)](https://community.obsidian.md/plugins/metadata-validator)
[![Release](https://github.com/flowing-abyss/obsidian-metadata-validator/actions/workflows/release.yml/badge.svg)](https://github.com/flowing-abyss/obsidian-metadata-validator/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/flowing-abyss/obsidian-metadata-validator/total?style=flat-square&label=downloads&color=blue)](https://github.com/flowing-abyss/obsidian-metadata-validator/releases)

Describe what a note's properties should look like in a `manifest.md`, and the plugin checks every matching note, fills in what it can, and keeps the properties in order. Rules add the conditional part, for example "when the status is done, set the end date".

## Where manifests live

Manifests sit in a schemas folder (set in the plugin settings) and inherit down the tree. A note gets the closest manifest whose `target` matches it.

```
vault/
└── schemas/
    ├── manifest.md            base schema
    ├── rules.md               rules for every manifest below
    ├── sources/
    │   ├── manifest.md        extends base
    │   └── books/
    │       └── manifest.md    extends sources
    └── projects/
        └── manifest.md        extends base
```

## A complete example

One manifest for project notes. It matches notes tagged `#project`, describes their properties, keeps them in a fixed order, and has three rules.

```yaml
---
name: Project
description: A finite piece of work with one result.
target:
  query: "#project"
enforce_folder: projects
fields:
  tags:
    type: multiselect
    required: true
    sort: alphabetical
  status:
    type: select
    required: true
    default: inbox
    options:
      - { value: inbox, label: Inbox }
      - { value: wip, label: In progress }
      - { value: done, label: Done }
  priority:
    type: select
    default: normal
    options: [{ value: high }, { value: normal }, { value: low }]
  category:
    type: multilink
    source:
      query: "#category"
  start:
    type: date
  end:
    type: date
  icon:
    type: text
    hidden: true
    fixed: 🗂️
rules:
  - name: start on wip
    when: "status=wip AND start="
    then:
      set: { start: "{{today}}" }
  - name: end on done
    when: "status=done AND end="
    then:
      set: { end: "{{today}}" }
  - name: category tags
    then:
      remove: { tags: "category/*" }
      add: { tags: "category/{{category|name|snake}}" }
formatting:
  property_order: [tags, status, priority, category, start, end, icon]
---
```

This runs on save, on open, and when you start the vault auto-fix from the sidebar. Missing properties get their `default`, `icon` is always the fixed value, the two date rules fill in empty dates, the tag rule keeps `category/*` tags equal to the category links, and the properties are reordered. Anything the plugin cannot fix shows up in the sidebar and as an icon next to the property.

## Manifest keys

| Key | Meaning |
|---|---|
| `name`, `description` | shown in the sidebar and in the properties modal |
| `target.query` | which notes this manifest applies to, see the query language below |
| `enforce_folder` | notes matching this manifest are moved into this folder |
| `extends` | path of the parent manifest, when it is not the parent folder |
| `exclude` | names of inherited fields or rules to drop |
| `priority` | when several manifests match, the higher priority wins |
| `fields` | the properties, see below |
| `rules` | the rules, see below |
| `formatting.property_order` | order of properties in the note |

## Field keys

Types are `text`, `number`, `select`, `multiselect`, `list`, `date`, `link`, `multilink`, `boolean` and `url`.

| Key | Meaning |
|---|---|
| `required` | the property must be present |
| `default` | inserted when the property is empty |
| `fixed` | always this value |
| `options` | allowed values, a list of `{ value, label, description }`, or `{ source: ... }` for a computed list |
| `strict: false` | values outside `options` are left alone |
| `source` | for links, which notes are allowed. `query`, `folder`, `tag` or `js` |
| `validate_exists: false` | do not require the linked note to exist |
| `sort` | `alphabetical` or `alphabetical-desc` for lists |
| `min`, `max` | range for numbers |
| `format` | date format, for example `YYYY-MM-DD` |
| `label`, `description`, `hidden` | how the property appears in the editing modal |
| `validate.js` | custom check, return `true` or an error message |

## Query language

Used in `target.query`, in `source.query` and in rule conditions.

| Term | Matches when |
|---|---|
| `#project` | the note has this tag or a child tag |
| `projects/` | the note is in this folder |
| `status=done` | the property equals the value, or a list contains it |
| `end=` | the property is empty |
| `rating>=8`, `end<2026-01-01` | numbers and dates compare as such |
| `-term`, `AND`, `OR`, `( )` | negation, both, either, grouping |

## Rules

A rule says what the properties should look like when a condition holds. It runs on the note's current state, so it behaves the same on save, on open and in the vault auto-fix, and it does nothing when the note is already correct.

```yaml
rules:
  - name: end on done
    description: Done work gets its end date.
    when: "status=done AND end="
    then:
      set: { end: "{{today}}" }
```

`name` and `description` are optional. The properties modal lists the rules under the schema and shows the description on hover.

`when` is a query string, or one of these forms, and can be nested.

```yaml
when: { project: { when: "status=done" } }       # a linked note in `project` matches
when: { tasks: {} }                               # `tasks` has at least one value
when: { and: ["status=done", { not: ["end="] }] } # also `or`
when: { js: "return fm.status === 'done'" }
```

`then` holds verbs that run in the order written.

| Verb | Does |
|---|---|
| `set: { end: value }` | write the value, `null` clears |
| `add: { tags: value }` | add to a list, no duplicates |
| `remove: { tags: value }` | remove from a list, `*` is a wildcard |
| `js: "..."` | run code with the note's `fm` |

A value is a literal, a template or a selection. A selection `{ meta: { when: "#problem" } }` means the links in `meta` whose note matches, and `{ meta: {} }` means all of them.

Templates use `{{today}}`, `{{now}}`, `{{file.name}}` or any property, with optional filters: `name` (link to note name), `snake`, `kebab`, `lower`, `upper`, `trim`, `replace:"a","b"`, `join:", "`, `date:"YYYY-MM-DD"`.

### Common rules

Dates that follow the status.

```yaml
  - when: "status=wip AND start="
    then:
      set: { start: "{{today}}" }
  - when: "status=dropped"
    then:
      set: { end: null, priority: low }
```

Tags that mirror a property. The first rule removes every `status/*` tag, the others add the right one.

```yaml
  - then:
      remove: { tags: "status/*" }
  - when: "status=wip"
    then:
      add: { tags: status/wip }
  - when: "status=done"
    then:
      add: { tags: status/done }
```

Links that belong in another property. When a note in `meta` has become a problem, its link moves to `problem`, and the other way round.

```yaml
  - then:
      add:
        problem: { meta: { when: "#problem" } }
        meta: { problem: { when: "#meta" } }
      remove:
        meta: { when: "#problem" }
        problem: { when: "#meta" }
```

A kanban in properties. Tasks move between `todo`, `wip` and `done` by their own status.

```yaml
  - then:
      add:
        wip: { todo: { when: "status=wip" }, done: { when: "status=wip" } }
        done: { todo: { when: "status=done" }, wip: { when: "status=done" } }
      remove:
        todo: { when: "-status=todo" }
        wip: { when: "-status=wip" }
        done: { when: "-status=done" }
```

State taken from a linked note. A task closes when its project closes, and a project closes when all its tasks are closed.

```yaml
  - when: { project: { when: "status=done" } }
    then:
      set: { status: done }
  - when:
      and:
        - tasks: {}
        - not:
            - tasks: { when: "-status=done" }
    then:
      set: { status: done }
```

Overdue work.

```yaml
  - when: "end<{{today}} AND -status=done"
    then:
      add: { tags: overdue }
  - when: { or: ["end>={{today}}", "status=done", "end="] }
    then:
      remove: { tags: overdue }
```

### Where rules live

Rules go in a manifest, or in a `rules.md` file anywhere in the schemas folder. A `rules.md` applies to every manifest in its folder and below. Rules from `rules.md` files run first, then the manifest chain from the root ancestor down. A rule with the same `name` replaces the earlier one.

When a note changes type, the notes linking to it are checked again so rules like the link transfer above run right away. This can be turned off in the settings.
