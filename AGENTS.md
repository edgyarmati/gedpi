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

**Agent flow**: Ged now starts in normal Pi behavior by default. When `/ged-mode` is enabled, one brain interviews the user, writes the spec into `.ged/`, breaks work into bounded slices, implements them, and records verification/results in durable memory.

Future orchestration work should follow `docs/single-writer-intelligence-orchestration.md`: keep the primary Ged brain as the default writer and decision owner, use additional agents/model calls as read-only scouts, smart friends, or clean-context reviewers, and only allow writer workers through explicit branch/worktree-backed isolation. Do not reintroduce unstructured multi-agent writer swarms.

**Memory**: `.ged/` files hold durable project standards, context, and Ged workflow state — not source code. When Ged mode is off, only the durable standards/context should be treated as active guidance. `.pi/` is Pi-runtime-local state and should stay out of Git.

**Extensions**: Pi loads extensions listed in `package.json` under `pi.extensions`. Custom entrypoints live in `extensions/`. Third-party extensions are referenced via `./node_modules/` paths.

**Bundled extensions** (loaded in order):
- `ged-core` — brain workflow, themed UI, header, shortcuts, updater
- `ged-memory` — `.ged/` durable memory bootstrap
- `glimpseui` — native micro-UI windows and floating companion widget
- `pi-web-access` — web search and fetch tools
- `pi-interview` — guided Q&A for clarification
- `pi-diff-review` — diff review surface
- `pi-prompt-template-model` — prompt template / model wiring
- `pi-extension-settings` — settings persistence
- `pi-powerbar` — powerline-style status bar

**Skills**: Bundled workflow skills live in `skills/`. Pi discovers them via `pi.skills` in `package.json`.
Bundled defaults now include `find-skills`, `skill-creator`, and `brainstorming`, so Ged can discover, create, and use planning-oriented skills without external installation.

## Workflow

Always document plans and progress. Before making changes, state what you intend to do. After completing tasks, summarize what was done.

`/ged-mode` is persistent per project through `.pi/settings.json`.

When Ged mode is off:
- keep the normal Pi behavior
- treat `.ged/PROJECT.md`, `.ged/SPEC.md`, `.ged/DECISIONS.md`, `.ged/CONFIG.md`, `.ged/SKILLS.md`, and `.ged/STANDARDS.md` as passive guidance if present
- ignore `.ged/TASKS.md`, `.ged/STATE.md`, `.ged/TESTS.md`, `.ged/tasks/`, and `.ged/SESSION-SUMMARY.md` for workflow execution

When Ged mode is turned on for a project:
- lazily initialize or migrate `.ged/` on the first real agent turn
- discover external standards files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/**/*.mdc`, `.cursorrules`, `.windsurf/rules/**`, and `.continue/rules/**`
- ask the user whether to keep repo-wide standards in Ged's durable config
- automatically install matching task skills into `.ged/project-skills/`, create a project skill when none exists, track skill dependencies per task, and remove project-scoped skills once no open task still depends on them
- ensure `.pi/` is ignored in `.gitignore` when the project is a Git repo

**Commits**: After completing any task — including individual implementation slices, bug fixes, refactors, or cleanup — create a git commit to snapshot the work. Before committing, run the `verify` skill (`npm run check && npm run lint && npm test`) and fix any failures. Use conventional commit format (`feat:`, `fix:`, `refactor:`, `chore:`, etc.). Never leave completed work uncommitted. Check `git status` after each task; if there are staged or unstaged changes, commit them.

## TypeScript

- ES modules only — NodeNext module resolution, `import.meta.url` for paths. No CommonJS in `src/` or `extensions/`.
- Strict mode enabled. `npm run check` must pass before committing.
- `bin/gedpi.js` is plain JS (not TypeScript) — the launcher has no compile step.

## Testing

Tests live in `tests/`. Vitest covers the durable planning/implementation workflow and extension wiring.

## Model API Keys

The Pi runtime manages model credentials externally. No API key setup is required in this repo.
