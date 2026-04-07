# Metadata Validator

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

## Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `flowing-abyss/obsidian-metadata-validator`
