# AGENTS.md

This file provides guidance to Codex and other AI agents when working with code in this repository.

`AGENTS.md` is the canonical agent guidance for this repository. Keep harness-specific files such as `CLAUDE.md` as thin pointers to this file instead of duplicating the full instructions; if guidance changes, update this file first.

## Commands

- `npm test` — run the test suite (Vitest)
- `npm run check` — TypeScript type-check
- `npm run lint` — Biome lint + format check (use `npm run format` to auto-fix)
- `node ./bin/gedpi.js` — launch locally in dev mode

## Architecture

GedPi is a batteries-included Pi package built around a single conversational brain.

**Agent flow**: GedPi always starts in full workflow mode. One brain clarifies ambiguous requests, writes the spec into `.ged/`, breaks work into bounded slices, implements them, and records verification/results in durable memory. The agent classifies tasks as trivial or non-trivial and adjusts its behavior accordingly — no manual toggle needed.

Future orchestration work should follow `docs/single-writer-intelligence-orchestration.md`: keep the primary Ged brain as the default writer and decision owner, use additional agents/model calls as read-only scouts, smart friends, or clean-context reviewers, and only allow writer workers through explicit branch/worktree-backed isolation. Do not reintroduce unstructured multi-agent writer swarms.

**Memory**: `.ged/` files hold durable project standards, context, and Ged workflow state — not source code. `.pi/` is Pi-runtime-local state and should stay out of Git.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Custom entrypoints live in `extensions/`. Third-party extensions are referenced via `./node_modules/` paths.

**Bundled extensions and extension packages**:
- `ged-core` — brain workflow, header, shortcuts, updater
- `ged-memory` — `.ged/` durable memory bootstrap
- `glimpseui` — native micro-UI windows and floating companion widget
- `pi-web-access` — web search and fetch tools
- `@tintinweb/pi-subagents` — read-only scout, planner, and verifier subagent tools
- `pi-diff-review` — diff review surface
- `pi-prompt-template-model` — prompt template / model wiring
- `pi-extension-settings` — settings persistence
- `amp-themes` — theme files plus editor and user-message styling selected through Pi settings
- `pi-tool-display` — tool display renderer bundled through `amp-themes`
- `pi-fixed-editor` — keeps the input box pinned while chat history scrolls

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.
Bundled defaults now include `find-skills`, `skill-creator`, and `brainstorming`, so Ged can discover, create, and use planning-oriented skills without external installation.

## Workflow

Always document plans and progress. Before making changes, state what you intend to do. After completing tasks, summarize what was done.

The Ged workflow is always active:
- lazily initialize or migrate `.ged/` on the first real agent turn
- discover external standards files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/**/*.mdc`, `.cursorrules`, `.windsurf/rules/**`, and `.continue/rules/**`
- ask the user whether to keep repo-wide standards in Ged's durable config
- automatically install matching task skills into `.ged/project-skills/`, create a project skill when none exists, track skill dependencies per task, and remove project-scoped skills once no open task still depends on them
- ensure `.pi/` is ignored in `.gitignore` when the project is a Git repo

**Commits**: After completing any task — including individual implementation slices, bug fixes, refactors, or cleanup — create a git commit to snapshot the work. Before committing, run the `verify` skill (`npm run check && npm run lint && npm test`) and fix any failures. Use conventional commit format (`feat:`, `fix:`, `refactor:`, `chore:`, etc.). Never leave completed work uncommitted. Check `git status` after each task; if there are staged or unstaged changes, commit them.

**Changelog**: Every committed change that is user-facing (features, fixes, behavior changes, dependency bumps, deprecations) must add an entry under `## Unreleased` in `CHANGELOG.md`. Group entries by category (`### Features`, `### Fixes`, `### Documentation`, `### Dependencies`, etc.). Keep the changelog current during each slice — don't batch it at release time. On release, `## Unreleased` is renamed to `## X.Y.Z - YYYY-MM-DD` and a fresh `## Unreleased` header is added.

## Releases

GedPi is published to npm as `gedpi`.

### How to release

1. Ensure `CHANGELOG.md` has all changes under `## Unreleased`.
2. Bump `version` in `packages/gedpi/package.json` to the new version.
3. Rename `## Unreleased` to `## X.Y.Z - YYYY-MM-DD` and add a new `## Unreleased` section at the top.
4. Commit: `chore: release gedpi X.Y.Z`.
5. Tag: `git tag gedpi-vX.Y.Z`.
6. Push: `git push origin main --tags`.
7. The `release-gedpi.yml` workflow will: verify → npm pack → npm publish with provenance → create GitHub release.

### Tag format

- GedPi releases use `gedpi-v*` tags (e.g., `gedpi-v0.13.0`).
- GedCode releases use `gedcode-v*` tags — they are independent.

### Packaging guardrails

- Do not add published `file:` dependencies that point at vendored directories already included in `files` or loaded through `pi.extensions`. Npm may install nested `node_modules` inside those vendored directories, which can break global upgrades with stale `ENOTEMPTY` removal errors.
- For vendored extension code, include the source directory through `files`, load it via the `pi.extensions` path, and use peer dependencies for host-provided packages such as `glimpseui` and Pi APIs.
- Before releasing packaging changes, run `npm pack --dry-run` and confirm the tarball does not include nested `node_modules`, package lockfiles from vendored directories, or dependency links to vendored packages.

### Deprecation note

The previous npm package `omni-pi` is deprecated. `gedpi` is the active package.

## TypeScript

- ES modules only — NodeNext module resolution, `import.meta.url` for paths. No CommonJS in `src/` or `extensions/`.
- Strict mode enabled. `npm run check` must pass before committing.
- `bin/gedpi.js` is plain JS (not TypeScript) — the launcher has no compile step.

## Testing

Tests live in `tests/`. Vitest covers the durable planning/implementation workflow and extension wiring.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
