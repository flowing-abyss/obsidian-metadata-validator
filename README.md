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
