# Metadata Validator

Manifest-driven metadata validation for Obsidian. Define schemas in `_manifest.md` files — they inherit down the folder tree.

## Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `flowing-abyss/obsidian-metadata-validator`

## How manifests work

```
vault/
├── _manifest.md          ← base schema (applies everywhere)
│
├── sources/
│   ├── _manifest.md      ← inherits base, adds source-specific fields
│   └── books/
│       └── _manifest.md  ← inherits sources, adds book-specific fields
│
└── people/
    └── _manifest.md      ← inherits base, adds person-specific fields
```

Each `_manifest.md` defines fields in its frontmatter. Child manifests extend their parent — fields are merged, child wins on conflict.

```yaml
# vault/sources/books/_manifest.md
extends: ../  # optional — inferred automatically from folder nesting

fields:
  title:
    type: text
    required: true
  rating:
    type: number
    min: 1
    max: 5
  status:
    type: select
    options: [to-read, reading, done]
    default: to-read
```

A note gets the schema of the deepest `_manifest.md` above it in the folder tree.
