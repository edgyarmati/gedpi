# GedPi

A batteries-included [Pi](https://github.com/badlogic/pi-mono) package with an opt-in Ged workflow for interviewing, documenting the spec, and implementing work in bounded slices.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/gedpi.svg)](https://www.npmjs.com/package/gedpi)
[![CI](https://github.com/EdGy2k/GedPi/actions/workflows/ci.yml/badge.svg)](https://github.com/EdGy2k/GedPi/actions/workflows/ci.yml)

## What It Does

- Starts in normal Pi behavior with an opinionated setup.
- `/ged-mode` turns on Ged's specialized interview, plan, build, and verify workflow for the current project.
- Keeps durable standards and project context in `.ged/`, even when Ged mode is off.
- Writes specs, tasks, and progress into `.ged/` once Ged mode is enabled.
- Adds a repo map that indexes supported source files, ranks them by structure plus recent activity, and injects a compact codebase-awareness block into Ged prompts.
- Bundles web search, guided interviews, themed UI, native micro-UI via Glimpse, native git diff review, prompt-template-powered workflow commands, a task viewer, a powerbar, and automatic updates out of the box.
- Documents a future [single-writer intelligence orchestration](docs/single-writer-intelligence-orchestration.md) model: keep the Ged brain as the default writer while using scouts, smart friends, and clean-context reviewers for additional intelligence.

## Install

```bash
npm install -g gedpi
```

Then run it in any project:

```bash
cd your-project
ged
```

## Features

### Bundled Skills

GedPi now ships the essential skill-discovery stack in the package itself:

- `find-skills` is bundled for discovering relevant skills
- `skill-creator` is bundled for creating project-specific skills when nothing suitable exists
- `brainstorming` is bundled and used for Ged planning and task creation flows

### Repo Map

GedPi now includes a SoulForge-style repo map for codebase awareness while Ged mode is on.

The first shipped version includes:

- incremental indexing of supported repo files while respecting `.gitignore`
- symbol/import extraction for TypeScript/JavaScript-family files with graceful fallback for partial/unsupported cases
- graph-aware ranking blended with current-turn boosts from recent reads, edits, writes, and prompt mentions
- budget-aware prompt rendering so Ged gets a compact ranked view of important files and exported symbols
- runtime cache storage under `.pi/repo-map/` rather than durable `.ged/` memory

Current deferred roadmap items remain intentional and visible in docs rather than hidden in code:

- semantic symbol summaries
- git co-change ranking
- richer analysis views such as dead-code or clone-detection signals
- broader parser/language coverage as needed

### Bundled Extensions

| Extension | What it does |
|-----------|-------------|
| **ged-core** | Brain workflow, themed header, session init, system prompt injection |
| **ged-memory** | `.ged/` durable memory bootstrap |
| **glimpseui** | Native micro-UI windows and the optional floating companion widget |
| **pi-web-access** | Web search and fetch tools for the agent |
| **pi-interview** | Guided Q&A when the agent needs clarification |
| **pi-diff-review** | Native git diff review window that inserts structured review feedback into the editor |
| **pi-prompt-template-model** | Prompt templates can set thinking/model behavior and back commands like `/commit` and `/push` |
| **pi-powerbar** | Powerline-style status bar with segments |
| **pi-extension-settings** | Settings persistence for extensions |

### Native Micro-UI

GedPi now bundles [Glimpse](https://github.com/HazAT/glimpse) for native micro-UI windows:

- the bundled `glimpse` skill lets the agent open native dialogs, forms, previews, and other rich UI when a task benefits from it
- the `/companion` command toggles an optional floating status pill that follows the cursor and reflects live agent activity
- the companion is optional; Glimpse-backed windows remain available even when the floating widget is disabled

### Commands

| Command | Description |
|---------|-------------|
| `/ged-mode` | Toggle persistent Ged mode on or off for this project |
| `/companion` | Toggle the Glimpse floating companion widget |
| `/diff-review` | Open a native git diff review window and insert feedback into the editor |
| `/commit` | Review local changes and create a descriptive conventional commit |
| `/push` | Push the current branch, with automatic recovery flow if the first push fails |
| `/theme` | Switch between color presets (lavender, ember, ocean, mint, rose, gold, arctic, neon, copper, slate) |
| `/update` | Check for GedPi updates |

### Keyboard Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+Shift+T` | Toggle the task list widget (`.ged/TASKS.md` + `.ged/STATE.md`) |

### Auto-Updater

GedPi checks for new versions on startup (cached, re-checks every 4 hours). When an update is available, it prompts to install and restart. Pi's own update notification is suppressed to avoid duplication.

## Ged Mode

GedPi keeps its current branding and shell at all times, but the specialized workflow is opt-in.

- When Ged mode is off, Ged behaves like normal Pi and only uses `.ged/` as passive standards/context when those files already exist.
- When Ged mode is on, Ged lazily initializes or migrates `.ged/` on the first real turn, then uses the full interview, planning, task, and verification workflow.
- While Ged mode is on, Ged also maintains a runtime repo map in `.pi/repo-map/` so prompts can include a compact ranked view of important files and symbols.
- During Ged init, Ged can discover standards from files like `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, Cursor rules, Windsurf rules, and Continue rules, then ask whether to keep those standards in Ged's durable memory.
- In Git repos, Ged ensures `.pi/` is ignored because that directory is only runtime-local Pi state.
- While Ged mode is on, every planned or executed task checks for required skills, auto-installs matching skills into `.ged/project-skills/`, creates a project skill when none exists, records task-to-skill dependencies, and removes project skills once no open task still needs them.

## Durable Memory

GedPi keeps its working notes in `.ged/`:

| File | Purpose |
|------|---------|
| `PROJECT.md` | Problem, users, constraints, success criteria |
| `STANDARDS.md` | Imported standards accepted from other harness instruction files |
| `project-skills/` | Project-scoped skills auto-installed or created for active tasks |
| `SPEC.md` | Exact requested behavior and implementation shape |
| `TASKS.md` | Work broken into bounded slices |
| `TESTS.md` | Checks for the current slice |
| `STATE.md` | Current phase, active task, blockers |
| `SESSION-SUMMARY.md` | Progress notes across sessions |
| `DECISIONS.md` | Rationale for key choices |
| `VERSION` | Current `.ged/` standard version |

## Development

```bash
git clone https://github.com/EdGy2k/GedPi.git
cd GedPi
npm install
npm run chat    # launch locally in dev mode
```

| Command | Purpose |
|---------|---------|
| `npm run chat` | Launch the local `gedpi` executable |
| `npm test` | Run the test suite (Vitest) |
| `npm run check` | TypeScript type-check |
| `npm run lint` | Biome lint + format check |
| `npm run verify` | Full local/CI gate: type-check, lint, test, and package dry-run |
| `npm run format` | Auto-fix lint and formatting |
| `npm install -g .` | Install globally from local checkout |

## CI/CD

- Pull requests and pushes to `main` run `npm run verify`.
- The docs are part of the test contract.
- Pushing a `v*` tag runs the release workflow, verifies the repo again, publishes to npm through GitHub Actions trusted publishing with provenance, and then creates the GitHub release.
- Trusted publishing still requires npm-side setup for this repository/workflow in the npm package settings.

## Attribution

GedPi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
