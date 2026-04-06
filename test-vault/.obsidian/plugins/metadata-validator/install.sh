#!/usr/bin/env bash
# Run from repo root: bash test-vault/.obsidian/plugins/metadata-validator/install.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# metadata-validator → plugins → .obsidian → test-vault → obsidian-metadata (repo root)
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PLUGIN_DIR="$SCRIPT_DIR"

echo "Repo root: $REPO_ROOT"
echo "Copying built files → $PLUGIN_DIR"
cp "$REPO_ROOT/main.js" "$PLUGIN_DIR/main.js"
cp "$REPO_ROOT/styles.css" "$PLUGIN_DIR/styles.css"
echo "Done. Reload the plugin in Obsidian (Settings → Community plugins → Disable/Enable)."
