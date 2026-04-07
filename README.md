# Metadata Validator

Manifest-driven metadata validation for Obsidian. Define schemas in `manifest.md` files — they inherit down the folder tree.

## Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `flowing-abyss/obsidian-metadata-validator`

## How manifests work

```
vault/
└── schemes/
    ├── manifest.md          ← base schema
    │
    ├── sources/
    │   ├── manifest.md      ← inherits base, adds source-specific fields
    │   └── books/
    │       └── manifest.md  ← inherits sources, adds book-specific fields
    │
    └── people/
        └── manifest.md      ← inherits base, adds person-specific fields
```

Each `manifest.md` defines fields in its frontmatter. Child manifests extend their parent — fields are merged, child wins on conflict.

```yaml
# schemes/sources/books/manifest.md
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

A note gets the schema of the deepest `manifest.md` above it in the `schemes/` tree.
