
# Test Vault — Metadata Validator

This is a test vault for direct functional testing of the plugin.

## Quick Start

1. Build and install the plugin:
   ```bash
   npm run build:vault
   ```
2. Open this folder (`test-vault/`) as a vault in Obsidian.
3. Enable the plugin: **Settings → Community plugins → Metadata Validator → Enable**.

## Schema Structure

```
schemas/
├── manifest.md          ← Base (all notes, priority 0)
├── sources/
│   └── manifest.md      ← Source (folder sources/, priority 10)
├── books/
│   └── manifest.md      ← Book extends Source (folder books/, priority 20)
└── articles/
    └── manifest.md      ← Article extends Source (sources/ + tag article, priority 15)
```

## Test Cases

| File | Scenario | Expected Result |
|------|----------|---------------------|
| `sources/valid-source.md` | All fields are correct | Green badge |
| `sources/missing-author.md` | Missing required `author` | Red badge, error in sidebar |
| `sources/invalid-rating.md` | `rating: 2000` (allowed 1–10) | Red badge, range error |
| `sources/invalid-status.md` | `status: kek` (not in options) | Red badge, option error |
| `sources/no-status-gets-autofix.md` | No `status` field | Auto-fix: adds `status: new` |
| `books/clean-code.md` | Book, all fields correct | Green badge |
| `books/missing-author-book.md` | Book without `author` | Red badge |
| `notes/unschemaed-note.md` | No matching schema | No badge |

## Update the plugin after code changes

```bash
npm run build:vault
# Затем в Obsidian: Settings → Community plugins → отключить/включить Metadata Validator
```
