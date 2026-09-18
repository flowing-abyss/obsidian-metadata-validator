# Metadata Validator

[![Available in Obsidian](https://img.shields.io/badge/Available%20in%20Obsidian-7C3AED?logo=obsidian&logoColor=white&style=flat-square)](https://community.obsidian.md/plugins/metadata-validator)
[![Release](https://github.com/flowing-abyss/obsidian-metadata-validator/actions/workflows/release.yml/badge.svg)](https://github.com/flowing-abyss/obsidian-metadata-validator/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/flowing-abyss/obsidian-metadata-validator/total?style=flat-square&label=downloads&color=blue)](https://github.com/flowing-abyss/obsidian-metadata-validator/releases)

Manifest-driven metadata validation for Obsidian. Put `manifest.md` files in a `schemes/` folder — they inherit down the tree. Notes get the schema of the closest manifest above them.

```
vault/
└── schemes/
    ├── manifest.md          ← base schema
    ├── sources/
    │   ├── manifest.md      ← extends base
    │   └── books/
    │       └── manifest.md  ← extends sources
    └── people/
        └── manifest.md      ← extends base
```

## Rules

Rules fix state that fields cannot describe on their own: conditional values, derived tags, and
links that belong in another property. A rule is a function of the note's current frontmatter and
the vault, so it runs identically on save, on open, and in the vault auto-fix. When the note is
already correct, a rule does nothing.

```yaml
rules:
  - name: end on done            # optional, needed only to override or exclude in a child
    when: "status=🟩 AND end="   # optional; absent = always
    then:                        # verbs run in written order
      set: { end: "{{today}}" }
```

### Vocabulary

| Word | Meaning |
|---|---|
| `when` | condition on a note's metadata: a query string, a selection, `and` / `or` / `not`, or `{ js }` |
| `then` | verbs, in written order |
| `set` | write a value; `null` clears; a list replaces the list |
| `add` | add to a list without duplicates |
| `remove` | remove matching items from a list; `*` is a wildcard |
| `js` | escape hatch, gated by "Allow JavaScript execution" |

Query strings are the `target.query` language plus: `key=` means empty, `key=value` on a list
means contains, links compare by note name, and `<` `>` `<=` `>=` compare numbers, dates, or
strings. `{{…}}` on the right-hand side renders from the rule's own note.

A **selection** `{ property: { when: "…" } }` means "the values of `property` whose linked note
passes the condition"; `{ property: {} }` means all of its values. In `when` it is true when it
selects at least one value; in a value slot it yields the selected values. Under `add`, a
selection on another property names the source.

**Templates** use the Web Clipper syntax `{{value|filter|filter:arg}}`. Values: `today`, `now`,
`file.name`, `file.path`, `file.folder`, any property. Filters: `name` (link → note name),
`snake`, `kebab`, `lower`, `upper`, `trim`, `replace:"a","b"`, `join:", "`,
`date:"YYYY-MM-DD"`. A list value inside text expands into one string per element.

### Contract

- Each rule reads the note as it was when the rule started and writes sequentially, so a
  transfer (`add` from `meta`, `remove` from `meta`) works in either order.
- Order: `rules.md` files from the schemas root down, then manifests from the root ancestor down.
  A rule with the same `name` replaces the earlier one; a manifest's `exclude` drops rules by name.
- In a validation pass: field `fixed` / `default` → rules → `sort` and list shape → field checks →
  one write. `required` sees what a rule set; a rule cannot override `fixed`.
- `add` / `remove` need list fields (`list`, `multiselect`, `multilink`).
- Unresolved links never pass a selection. Unchanged notes are never written.

### Examples

```yaml
rules:
  # dates by stage, reset on drop
  - when: "status=🟦 AND start="
    then: { set: { start: "{{today}}" } }
  - when: "status=⬛"
    then: { set: { end: null, priority: ⏬ } }

  # property → tag mirror (namespace ownership)
  - when: "-#mark/no_sync"
    then: { remove: { tags: "status/*" } }
  - when: "status=🟩 AND -#mark/no_sync"
    then: { add: { tags: status/done } }

  # link → tag mirror
  - when: "-#mark/no_sync"
    then:
      remove: { tags: "category/*" }
      add: { tags: "category/{{category|name|snake}}" }

  # links to problem notes belong in `problem`, not `meta`
  - then:
      add:
        problem: { meta: { when: "#system/high/problem" } }
        meta: { problem: { when: "#system/high/meta" } }
      remove:
        meta: { when: "#system/high/problem" }
        problem: { when: "#system/high/meta" }

  # kanban inside properties
  - then:
      add:
        done: { todo: { when: "status=🟩" }, wip: { when: "status=🟩" } }
      remove:
        todo: { when: "-status=🟥" }

  # state from neighbours
  - when: { project: { when: "status=🟩" } }
    then: { set: { status: 🟩 } }
  - when:
      and:
        - tasks: {}
        - not:
            - tasks: { when: "-status=🟩" }
    then: { set: { status: 🟩 } }

  # anything else
  - then:
      js: |
        const map = { "🔺": "highest", "◽": "normal", "⏬": "lowest" };
        fm.tags = [].concat(fm.tags || []).filter(t => !String(t).startsWith("priority/"));
        if (map[fm.priority]) fm.tags.push("priority/" + map[fm.priority]);
```

### `rules.md`

Rules can also live in `rules.md` files anywhere under the schemas folder. A `rules.md` applies
to every manifest in its folder and below, so one at the schemas root applies to the whole vault.

### Neighbours

When a note changes type (its manifest changes, or `enforce_folder` moves it), the notes linking
to it are re-validated so their rules can move the link to the right property. Toggle this in
settings: "Revalidate linking notes when a note changes type".
