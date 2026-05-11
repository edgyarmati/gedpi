# Changelog

## Unreleased

### Features

- `/ged-agents setup` now lets users choose per-role thinking levels and persists them in generated subagent configuration.
- RTK routing now auto-detects the `rtk` binary instead of maintaining an on/off setting, and the command is now `/rtk` for status/install.
- Added a Pi extension setting for whether GedPi should leave verified work uncommitted, ask before committing, or commit automatically after verification.

## 0.17.6 - 2026-05-10

### Fixes

- Re-enabled the Amp editor with asynchronous Git status refreshes while keeping the fixed-editor compositor disabled.

## 0.17.5 - 2026-05-10

### Fixes

- Suppressed bundled Pi changelog notices on GedPi startup after Pi dependency upgrades while keeping GedPi's own update flow intact.
- Disabled the fixed-editor compositor extension to restore responsive typing while the no-lag redesign is investigated.

## 0.17.4 - 2026-05-09

### Fixes

- **Removed legacy Pi transitive install warnings** — vendored `pi-diff-review` now uses GedPi's top-level `glimpseui` package instead of installing an older nested copy that pulled deprecated `@mariozechner/*` Pi packages.

## 0.17.3 - 2026-05-09

### Fixes

- **Fixed Pi CLI resolution under package exports** — the launcher now resolves the installed Pi CLI file without relying on package root export resolution, restoring release verification on Node 24.
- **Fixed inactive Husky checks** — the root `prepare` script now installs the repository's `.husky` hooks into Git's configured hooks directory so commit/push checks run locally.

## 0.17.2 - 2026-05-09

### Fixes

- **Fixed MODULE_NOT_FOUND on `npm install`** — the launcher now uses `require.resolve` to locate the Pi CLI dependency instead of a hardcoded path, correctly handling npm dependency hoisting in local installs.
- **Fixed exports restriction bypass** — resolve the package main entry then derive the CLI path, avoiding subpath `exports` restrictions in `@earendil-works/pi-coding-agent`.

## 0.17.1 - 2026-05-09

## 0.17.0 - 2026-05-08

### Features

- **Fixed editor compositor** — new minimal `vendor/pi-fixed-editor` extension keeps the input box pinned at the bottom while scrolling chat history. Loaded after amp-themes. If a future Pi update breaks it, simply remove `./vendor/pi-fixed-editor/index.ts` from `pi.extensions` in `package.json`.
- **Default theme `amp-gruvbox-dark-hard`** — new GedPi users (or users without a global theme preference) now default to the `amp-gruvbox-dark-hard` theme. Existing user theme choices in `~/.pi/agent/settings.json` are respected.

## 0.16.0 - 2026-05-07

### Breaking Changes

- **Checkpoint schema v2** — `.ged/runtime/<work-id>/checkpoints.json` now requires `schemaVersion: 2`. Legacy v1 checkpoints are rejected with a migration message. Agents must re-classify tasks to create v2 state.
- **Subagent enforcement** — planner, verifier, and explorer checkpoints now require `source: "auto"` provenance. Only the auto-recording hook (which detects real `Agent` dispatches) stamps this field. Hand-written checkpoint entries are rejected by the structural guards.
- **Explorer-first guard** — for non-trivial work, source file inspection (read, grep, find, exploratory bash) is blocked until `ged-explorer` has completed its initial reconnaissance. Only `.md` and `.ged/` files may be read before the explorer runs.
- **Grill-me enforcement** — planner validation now requires a `clarification` checkpoint with structured evidence (goal, users, scope, constraints). The planner subagent also refuses to plan if the orchestrator's dispatch lacks a `## Grill-me evidence` block.
- **Planner consumed on commit** — every commit now clears the planner checkpoint, forcing re-planning before the next source edit. A single planner dispatch no longer acts as a permanent hall pass for all future work on the branch.

### Features

- **Branch hygiene nudge** — when the agent is on `main`, `master`, or a detached HEAD, the system prompt now includes a prominent nudge recommending a feature branch. This gives each piece of work a dedicated `.ged/work/<branch>/` namespace.
- **Comprehensive explorer prompt** — the explorer subagent prompt now instructs broad reconnaissance: map file structure, identify key types, trace dependency graphs, spot patterns, and report with structured output.
- **Planner grill-me contract** — the planner subagent now checks for a `## Grill-me evidence` block and refuses to plan if it's missing.
- **Orchestration diagrams** — README now includes ASCII diagrams for single-brain and subagent orchestration modes, plus a detailed three-tier memory architecture section.

### Fixes

- **Null-branch warning in GedCode** — `buildBranchNudge(null)` now correctly emits the root namespace warning for detached HEAD (previously returned empty string).
- **GedCode verifier guard message** — updated to handle the new "(auto-recorded)" suffix in missing checkpoint entries.

## 0.15.3 - 2026-05-06

### Fixes

- **Removed OMNI ASCII art header** — the 6-line block-letter "OMNI" ASCII art that flashed briefly on `/new` and `gedpi --continue` has been removed. The session header now shows a compact `GedPi vX.Y.Z` subtitle, the `plan · build · verify` tagline, and a random welcome message. The theme picker preview mirrors the new compact style.

## 0.15.2 - 2026-05-06

### Fixes

- **Robust auto-updater** — `npm install -g` now uses `--force` and automatically retries once when npm fails with `ENOTEMPTY`, `EACCES`, or `EBUSY`. On stale-directory errors, the updater parses the offending path from npm's stderr, removes it, and retries. Error messages are now categorized (permission, network, stale-directory, unknown) and include actionable manual commands when applicable.

## 0.15.1 - 2026-05-05

### Fixes

- **Vendored `@ged/shared-checkpoints` into gedpi** — the shared checkpoint package was referenced via `file:../shared` which npm excludes from published tarballs, causing `Cannot find module '@ged/shared-checkpoints'` at runtime. The code is now bundled directly at `src/vendor/shared-checkpoints.{js,d.ts}`.

## 0.15.0 - 2026-05-05

- **Interactive `/ged-agents setup` wizard** — Pi-native menu-driven setup for subagent models. Uses `ctx.ui.select`, `ctx.ui.input`, and `ctx.ui.confirm` for a step-by-step flow: pick scope, search for models per role, confirm, apply. Non-UI sessions get compact copy-paste commands.
- **Searchable model picker** — type any part of a model name, ID, or provider to filter available models. Single match auto-selects; multiple matches show a pick list; no matches retry with a warning.
- **Keep current option** — each role picker starts with "Keep current: <model>" so you can change only the roles you want without touching others.
- **Fallback chain support** — settings JSON accepts `{ "model": "...", "fallback": ["...", "..."] }`. Cross-provider fallbacks are auto-generated based on the primary model's provider. Status output renders chains as `primary → fallback1 → fallback2`.
- **`/ged-agents model` command** — one-liner to set/clear per-role models with `--project` or `--global` scope. Supports `default` as a pseudo-role for the shared defaultModel.
- **`/ged-agents models` command** — shows current effective model assignments with source tracing (role override, default, or orchestrator inherit).

### Fixes

- **Verifier commit guard enforcement** — auto-recorded verifier checkpoints now default to `blocksCommit: true`, and source file edits automatically invalidate existing verifier checkpoints. This closes the gap that allowed commits to slip through after verifier findings.

### Dependencies

- Extracted `@ged/shared-checkpoints` into a shared package used by both GedPi and GedCode for interchangeable checkpoint state.

## 0.14.0 - 2026-05-05

### Features

- **GedPi-branded welcome screen** — vendored pi-powerline-footer with a GED block-letter logo and "gedpi" title replacing the default Pi branding.
- **Replaced pi-powerbar with pi-powerline-footer** — powerline status bar now shows git branch/status, context usage, cost, model, and thinking level out of the box.
- **RTK defaults to auto** — RTK routing is now enabled by default when `rtk` is installed on the system; no longer requires `/ged-rtk on` to activate.

### Fixes

- Removed dead `ctrl+shift+t tasks` text from the header status line.
- Removed "GedPi Brain" dashboard widget from above the editor.

### Documentation

- Fixed README launch command (`ged` → `gedpi`), GitHub URLs (`EdGy2k/GedPi` → `edgyarmati/ged-mono`), dev clone instructions for monorepo layout, and tag format (`v*` → `gedpi-v*`).
- Updated bundled extensions table: added pi-intercom, pi-subagents, pi-powerline-footer; removed pi-powerbar.
- Updated bundled skills list with all 8 shipped skills.
- Expanded durable memory table from 10 to 18 entries to match actual `.ged/` contents.
- Updated commands table: removed non-existent `/companion`, added `/ged-rtk` and `/ged-agents`.

## 0.13.0 - 2026-05-05

### Breaking changes

- **Removed `/ged-mode` toggle** — the full Ged workflow is now always active. There is no passive/off mode. The agent classifies tasks as trivial or non-trivial internally.

### Features

- **Hard enforcement of planner and verifier checkpoints** — write/edit to source files is now structurally blocked until ged-planner has been dispatched for non-trivial work, and git commit is blocked until ged-verifier has been dispatched. Guards are implemented in the tool-call interception layer and cannot be bypassed by prompt instructions alone. Escape hatch available via `allowCheckpointBypass` setting.
- **Shared checkpoint package** (`@ged/shared-checkpoints`) — extracted checkpoint state types, validation, git commit detection, and auto-recording into a shared package used by both GedCode and GedPi. Ensures .ged/ memory format stays interchangeable.
- **Auto-recording of subagent dispatches** — when a Task tool dispatches ged-explorer, ged-planner, or ged-verifier, the checkpoint is automatically recorded without relying on the agent to write it manually.
- Strengthened orchestration prompt with prescriptive mandatory subagent dispatch instructions and exact tool-call formats.
- Updated ASCII logo to wider GEDPI design and simplified header subtitle.
- Added changelog version tracking to launcher settings for future upgrade notifications.

### Fixes

- Fixed orchestration test that leaked real user settings when no `.gedcode/settings.json` existed in the test directory.

### Documentation

- Added release instructions and changelog discipline rules to `AGENTS.md`.
- Updated `AGENTS.md` and `README.md` to reflect always-on workflow behavior.
- Added a single-writer intelligence orchestration implementation handoff for future GedPi work.

## 0.12.0 - 2026-04-27

### Security and robustness

- Sanitized untrusted text before it reaches brain prompts and `DECISIONS.md`
- Sanitized generated `SKILL.md` files and fixed `Set` mutation in loop
- Added atomic writes for `.ged/` and `.pi/` state files
- Hardened version parsing in the self-updater

### Bug fixes

- Fixed `isRequestRelated` to actually use the overlap ratio for planning continuity
- Fixed repo-map indexing, fingerprints, and dirty-path tracking
- Fixed backtick code span tracking in the task table parser
- Fixed prerelease ordering so pre-releases sort below their matching release in the updater
- Used `os.homedir()` for reliable home directory resolution in the updater
- Cached package version at module load to avoid repeated filesystem reads in the header

### Dependencies

- Upgraded `@mariozechner/pi-coding-agent` to `0.70.2`
- Upgraded `@anthropic-ai/claude-agent-sdk` to `0.2.119`
- Upgraded `@juanibiapina/pi-powerbar` to `0.9.1`
- Upgraded `pi-interview` to `0.8.6`
- Upgraded `pi-prompt-template-model` to `0.9.1`
- Upgraded `glimpseui` to `0.8.0`
- Upgraded `@biomejs/biome` to `2.4.13`
- Upgraded `typescript` to `6.0.3`
- Upgraded `vitest` to `4.1.5`
- Upgraded `@types/node` to `25.6.0`

### Housekeeping

- Hoisted control-char regexes and applied Biome formatting
- Included tests in `tsc` check and added launcher type declarations
- Added `tsbuildinfo` and coverage artifacts to `.gitignore`
- Enforced commit-after-every-task rule in `AGENTS.md`

## 0.11.0 - 2026-04-24

### Removed

- Removed `/model-setup`, `/manage-providers`, the `ged-providers` extension, and the bundled provider catalog. Pi now handles provider and model management natively.
- Removed `PROVIDERS.md` and the provider docs spec.

## 0.10.1 - 2026-04-24

### Release follow-up

- republished the previous 0.10.0 release work under a new patch version because npm will not republish a previously published version number
- kept the bundled `pi-diff-review` and `pi-prompt-template-model` integration changes intact

## 0.10.0 - 2026-04-24

### Removed

- Removed `/model-setup`, `/manage-providers`, and the `ged-providers` extension. Pi now handles provider and model management natively.

### Runtime and integrations

- upgraded `@mariozechner/pi-coding-agent` to `0.70.0`
- bundled `pi-diff-review` as a packaged GedPi dependency so `/diff-review` is available out of the box
- vendored `pi-diff-review` locally so global installs no longer fail on the extension's git prepare hook
- bundled `pi-prompt-template-model` so packaged prompt templates can register smarter slash commands

### Commands

- added `/commit` to review local changes and create a descriptive conventional commit
- added `/push` with a deterministic first `git push` attempt that only hands off to the model when the push fails

## 0.8.3 - 2026-04-17

### Model refresh flow

- added a custom model refresh flow so newly released provider models can be picked up without repeating setup from scratch
- stored refresh state separately so daily checks can detect when a refresh is needed and avoid redundant prompts
- added coverage for the refresh command, state handling, and daily refresh behavior

## 0.8.2 - 2026-04-07

### Single-brain runtime

- removed the legacy multi-agent execution path and deleted the dormant subagent runtime
- simplified task execution to a single-brain retry flow with recovery notes instead of worker/expert escalation
- removed outdated worker, expert, and planner role/config concepts so runtime, config, and tests now match the current brain-only architecture

### Startup

- defaulted first-run `gedpi` launcher installs to quiet startup so package resource listings do not appear unless the user opts in

### Model setup and config

- simplified Ged model configuration to a single `brain` model assignment
- stopped offering automatic model discovery for `google-generative-ai`, which was not implemented
- stopped persisting fake placeholder API keys for local or unauthenticated custom providers

### Dependencies

- removed the unused `pi-subagents` dependency
- added npm overrides for `@mozilla/readability`, `brace-expansion`, `picomatch`, and `vite`

## 0.8.1 - 2026-04-07

- blocked Anthropic oAuth login to avoid bans from recent policy changes on the Claude Code subscription ToS

## 0.8.0 - 2026-04-06

### Runtime and UX

- upgraded `@mariozechner/pi-coding-agent` to `0.65.2`

### Ged mode

- changed GedPi to start in standard Pi behavior by default while keeping Ged branding and shell UI
- added persistent `/ged-mode` to toggle the specialized Ged workflow per project
- made Ged mode initialize or migrate `.ged/` lazily on the first real turn instead of at session start
- fixed the first-turn Ged onboarding race so the kickoff instructions are folded into the active prompt instead of trying to enqueue a second user message mid-turn

### Durable standards and memory

- split passive `.ged/` standards from active workflow state so normal mode can still follow durable project guidance without resuming task execution
- added `.ged/VERSION` and migration handling for the Ged durable-memory standard
- added external standards discovery/import for files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, Cursor rules, Windsurf rules, and Continue rules
- automatically add `.pi/` to `.gitignore` during Ged init or migration when the workspace is a Git repository

### Skills

- bundled `find-skills`, `skill-creator`, and `brainstorming` directly with the npm package as built-in default skills
- made Ged automatically check task skill requirements, install matching skills project-scope, create a project-specific skill when no match exists, and remove unused project skills when no open task still depends on them
- persisted task skill dependencies in `.ged/work/<work-id>/TASKS.md` so planning, dispatch, and execution share the same skill graph
- removed the mistaken default Rust-specific recommendations so task-driven skill discovery is now the primary path

### Documentation

- updated `README.md` and `AGENTS.md` to document opt-in Ged mode, bundled skills, standards import, and automatic task skill management

## 0.7.1 - 2026-04-05

### Dependencies

- upgraded `@mariozechner/pi-coding-agent` to `0.65.0`
- removed `session_switch` handler from ged-memory extension (event removed upstream; `session_start` now covers session switches via `event.reason`)

## 0.7.0 - 2026-03-30

### Interview-first workflow

- require the interview tool for ambiguous requests instead of ad hoc chat clarification
- treat direct instructions in this repo as Ged app/product behavior changes by default unless explicitly marked as meta
- add first-run onboarding for ambiguous projects so Ged captures goal, users, constraints, workflow preferences, and missing context before planning or implementation

### Planning continuity

- reset stale active tasks when a new request is unrelated to the previous work
- archive concise summaries of replaced task lists outside `.ged/work/<work-id>/TASKS.md` while keeping related follow-up work continuous

## 0.6.4 - 2026-03-30

### Publishing and release automation

- normalized the package repository URL to the canonical GitHub repository form used by npm trusted publishing
- updated GitHub Actions workflows to the current Node 24 action/toolchain path
- replaced the JavaScript GitHub release action with the GitHub CLI so the release workflow no longer depends on deprecated Node 20 action runtimes

### Runtime and UX

- upgraded `@mariozechner/pi-coding-agent` to `0.64.0`
- suppressed the redundant success toast after a successful self-update install while still prompting for restart

## 0.6.3 - 2026-03-30

### Runtime and UX

- upgraded `@mariozechner/pi-coding-agent` to `0.64.0`
- suppressed the redundant success toast after a successful self-update install while still prompting for restart

### Release workflow

- moved npm publishing ahead of GitHub release creation so failed npm publishes do not leave behind a misleading GitHub release
- kept trusted publishing with provenance as the release path for tagged builds

## 0.6.2 - 2026-03-30

### Native micro-UI

- bundled `glimpseui` as a first-class GedPi dependency
- loaded the packaged Glimpse Pi extension and `glimpse` skill so native dialogs, forms, previews, and overlays are available to the agent
- added support for the `/companion` command to toggle the optional floating Glimpse status widget

### Documentation

- documented the bundled Glimpse integration in `README.md`
- clarified that Glimpse UI support is available even when the floating companion is disabled

## 0.6.1 - 2026-03-29

### Provider management

- renamed bundled provider auth management from `/provider-auth` to `/manage-providers`
- narrowed `/model-setup` so its list flow removes only custom model entries, not whole custom providers
- updated command labels and docs to reflect the split between custom model setup and bundled provider auth management

### Documentation and validation

- added the bundled provider list to `PROVIDERS.md`
- added documentation coverage tests for the bundled provider list and the README command contract
- made docs drift fail the test suite when the code-backed provider list or command docs change without matching documentation

### CI/CD

- added a unified `npm run verify` gate for local development, CI, and prepublish checks
- updated CI to run the shared verify gate instead of separate ad hoc steps
- added a tag-triggered release workflow that re-verifies the repo, creates a GitHub release, and publishes to npm when workflow credentials are configured

## 0.6.0 - 2026-03-27

### Provider management

- restricted `/model-setup` to custom providers and custom model entries stored in `models.json`
- added `/provider-auth` to remove stored auth for bundled Pi providers from the UI
- added whole-provider removal for custom providers, not just single-model removal
- fixed `/model-setup list` so it only shows custom providers/models instead of the full authenticated runtime catalog

### Provider discovery and refresh

- added startup refresh for authenticated, discoverable custom providers
- preserved dynamic headers and other existing model metadata when custom providers are edited or rediscovered
- improved custom-provider onboarding so users can add a provider first and discover models automatically
- stopped persisting invalid `contextWindow: 0` and `maxTokens: 0` values for discovered providers

### Selector and UX improvements

- aligned GedPi setup selectors with Pi-style searchable selection behavior
- limited the custom searchable selector to 10 visible rows and only enabled search when more than 10 items are present
- improved bundled command descriptions and provider-management messaging

### Documentation

- documented the split between custom provider setup and bundled provider auth management in `README.md`
- added `PROVIDERS.md` with guidance for `/model-setup`, `/provider-auth`, and custom provider discovery behavior
