# Metadata Validator plugin

An Obsidian plugin that validates and auto-fixes note frontmatter against `manifest.md` schemas
placed in a schemas folder. Schemas inherit down the folder tree; a note gets the closest matching
manifest. State-based `rules` (when / then with set, add, remove) run in the same pass and fix
conditional, derived, and cross-link state.

## Commands

| Command                        | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `npm run dev`                  | Watch build (`main.js` in the repo root)             |
| `npm run build`                | Typecheck + esbuild production build                 |
| `npm run lint` / `lint:fix`    | ESLint with `eslint-plugin-obsidianmd`               |
| `npm test`                     | Vitest unit suite                                    |
| `npm run test:coverage`        | Vitest with coverage thresholds (95 lines / 85 br.)  |
| `npm run knip`                 | Unused exports and dependencies                      |
| `npm run format` / `format:check` | Prettier                                          |
| `npm run build:vault`          | Build and copy into `test-vault/` (demo vault)       |

The husky pre-commit hook runs nano-staged (prettier + eslint on staged files), knip, the
coverage suite, and the build. Keep all four green before committing.

## Layout

- `src/main.ts` — plugin lifecycle and event wiring only.
- `src/manifest/` — `manifest.md` / `rules.md` parsing and cache.
- `src/schema/` — inheritance (`merger`, `resolver`), target queries (`query`), field sources.
- `src/validation/` — the engine pass, field checks (`rules/`), auto-fix, note/batch writers.
- `src/rules/` — the rules engine: templates, conditions, selections, verbs, runner.
- `src/ui/` — decorators, modals, sidebar, Bases integration (manual testing only).
- Tests live next to code in `__tests__/` and use `obsidian-test-mocks` (see `vitest.config.ts`).

## Conventions

- Strict TypeScript, `async/await`, no `any`. Shared interfaces live in `src/types.ts`.
- TDD: write the failing test first, keep coverage above the thresholds in `vitest.config.ts`.
- Never disable, downgrade, or bypass an `eslint-plugin-obsidianmd` rule; fix the cause.
- `docs/` is gitignored — local specs and plans only. **Never commit `docs/`.**
- Do not bump the version, tag, or publish a release unless explicitly asked. The release flow
  is `npm version` + tag push, see the GitHub workflow.
- Rules engine semantics are fixed by the spec (`docs/superpowers/specs/2026-09-18-rules-engine-design.md`)
  and summarised in `README.md` → Rules. Vocabulary is closed: `when`, `then`, `set`, `add`,
  `remove`, `and`, `or`, `not`, `js`, `name`. Extend it only with a spec change.
- Rules are functions of state: no previous-state tracking, snapshot reads, sequential writes,
  no write when nothing changed. Keep those invariants when touching `src/rules/` or the engine.
- Use `dev-vault-manifests` for real checks with the Obsidian CLI. It is gitignored; its plugin
  folder symlinks to the repo root. Never write into the user's production vault unless asked.
- `test-vault/` is the committed demo vault for manual exploration; keep it minimal.

## Obsidian CLI

[Obsidian CLI](https://obsidian.md/help/cli) drives the running app from the terminal. The
vault must have been opened once in Obsidian (`open "obsidian://open?path=$PWD/dev-vault-manifests"`).

```shell
npm run build && obsidian vault="dev-vault-manifests" plugin:reload id=metadata-validator
obsidian vault="dev-vault-manifests" eval code="app.vault.getFiles().length"
obsidian vault="dev-vault-manifests" eval code="app.commands.executeCommandById('metadata-validator:auto-fix-vault')"
obsidian vault="dev-vault-manifests" eval code="JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('projects/Alpha.md')).frontmatter)"
obsidian vault="dev-vault-manifests" dev:dom selector=".mv-sidebar-issue" text
obsidian vault="dev-vault-manifests" dev:screenshot path=screenshot.png
obsidian vault="dev-vault-manifests" devtools
```

Typical loop: edit → `npm run build` → `plugin:reload` → `eval` to trigger and read state.
Plugin settings are stored in `data.json` at the repo root (gitignored) because of the symlink;
enable JavaScript rules there with `enableJsExecution: true`.

## References

- API docs: https://docs.obsidian.md
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
