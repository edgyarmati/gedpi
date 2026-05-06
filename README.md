# GedPi

A batteries-included [Pi](https://github.com/badlogic/pi-mono) package with an always-on workflow for interviewing, documenting the spec, and implementing work in bounded slices.

Requires Node.js 22 or newer.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/gedpi.svg)](https://www.npmjs.com/package/gedpi)
[![CI](https://github.com/edgyarmati/ged-mono/actions/workflows/ci.yml/badge.svg)](https://github.com/edgyarmati/ged-mono/actions/workflows/ci.yml)

## What It Does

- Starts with the full Ged workflow always active — the agent interviews, plans, implements, and verifies in bounded slices.
- Keeps durable standards and project context in `.ged/`.
- Writes specs, tasks, and progress into `.ged/` and tracks workflow state across sessions.
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
gedpi
```

## Features

### Bundled Skills

GedPi ships skills that power the Ged workflow and skill-discovery stack:

- `ged-init` — first-turn `.ged/` initialization and migration
- `ged-planning` — spec writing and task decomposition into bounded slices
- `ged-execution` — implementation of individual task slices
- `ged-verification` — post-implementation checks and state updates
- `ged-escalation` — automatic escalation when a slice repeatedly fails
- `find-skills` — discovering relevant skills from registries and repos
- `skill-creator` — creating project-specific skills when nothing suitable exists
- `brainstorming` — structured planning and task creation flows

### Repo Map

GedPi now includes a SoulForge-style repo map for codebase awareness.

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
| **@tintinweb/pi-subagents** | Claude-style `Agent`, `get_subagent_result`, and `steer_subagent` tools for read-only Ged scouts, planners, and verifiers |
| **pi-interview** | Guided Q&A when the agent needs clarification |
| **pi-diff-review** | Native git diff review window that inserts structured review feedback into the editor |
| **pi-prompt-template-model** | Prompt templates can set thinking/model behavior and back commands like `/commit` and `/push` |
| **pi-powerline-footer** | Powerline-style status bar with git, context, cost, model, and thinking segments |
| **pi-extension-settings** | Settings persistence for extensions |

### Optional: Claude Code CLI models

GedPi can route subagent requests through the Claude Code CLI for API-billed models that avoid per-token pricing. To enable:

```bash
# 1. Install the companion package alongside GedPi
npm install -g pi-claude-cli

# 2. Install and authenticate Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude auth login

# 3. Restart GedPi — models appear automatically
```

After setup, `/ged-agents setup` shows `pi-claude-cli/claude-opus-4-7`, `pi-claude-cli/claude-sonnet-4-5`, etc. Assign them per role:

```bash
/ged-agents model ged-planner pi-claude-cli/claude-sonnet-4-5
/ged-agents model ged-verifier pi-claude-cli/claude-opus-4-5
```

Model fallback chains (configured via `/ged-agents setup`) work with pi-claude-cli models too. If the Claude Code CLI isn't installed or authenticated, pi-claude-cli skips registration silently — GedPi starts normally without those models.

### Native Micro-UI

GedPi bundles [Glimpse](https://github.com/HazAT/glimpse) for native micro-UI windows. The bundled `glimpse` skill lets the agent open native dialogs, forms, previews, and other rich UI when a task benefits from it.

### Commands

| Command | Description |
|---------|-------------|
| `/diff-review` | Open a native git diff review window and insert feedback into the editor |
| `/commit` | Review local changes and create a descriptive conventional commit |
| `/push` | Push the current branch, with automatic recovery flow if the first push fails |
| `/theme` | Switch between color presets (lavender, ember, ocean, mint, rose, gold, arctic, neon, copper, slate) |
| `/update` | Check for GedPi updates |
| `/ged-rtk` | Install RTK and control Ged's bash-side RTK routing (status, install, on, off) |
| `/ged-agents` | Configure optional read-only Ged subagents (status, setup, on, off) |

### Auto-Updater

GedPi checks for new versions on startup (cached, re-checks every 4 hours). When an update is available, it prompts to install and restart. Pi's own update notification is suppressed to avoid duplication.

## Ged Workflow

GedPi always runs the full Ged workflow. There is no toggle — the agent classifies tasks as trivial or non-trivial and adjusts its behavior automatically.

- On the first agent turn, Ged lazily initializes or migrates `.ged/`.
- Ged discovers standards from files like `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, Cursor rules, Windsurf rules, and Continue rules, then asks whether to keep those standards in Ged's durable memory.
- Ged maintains a runtime repo map in `.pi/repo-map/` so prompts include a compact ranked view of important files and symbols.
- In Git repos, Ged ensures `.pi/` is ignored because that directory is only runtime-local Pi state.
- Every planned or executed task checks for required skills, auto-installs matching skills into `.ged/project-skills/`, creates a project skill when none exists, records task-to-skill dependencies, and removes project skills once no open task still needs them.

## Durable Memory

GedPi keeps its working notes in `.ged/`:

| File | Purpose |
|------|---------|
| `VERSION` | Current `.ged/` standard version |
| `PROJECT.md` | Problem, users, constraints, success criteria |
| `SPEC.md` | Exact requested behavior and implementation shape |
| `STANDARDS.md` | Imported standards accepted from other harness instruction files |
| `TASKS.md` | Work broken into bounded slices |
| `TESTS.md` | Checks for the current slice |
| `STATE.md` | Current phase, active task, blockers |
| `SESSION-SUMMARY.md` | Progress notes across sessions |
| `PROGRESS.md` | Ongoing log of project progress |
| `DECISIONS.md` | Rationale for key choices |
| `IDEAS.md` | Active, future, and parking-lot ideas |
| `SKILLS.md` | Installed, recommended, deferred, and rejected skills |
| `SKILLS-STATE.json` | Machine-readable managed-skills state |
| `project-skills/` | Project-scoped skills auto-installed or created for active tasks |
| `plans/` | Plan index and per-plan documents |
| `specs/` | Versioned detailed specs |
| `research/` | External research summaries and package notes |
| `tasks/` | Per-task briefs, outputs, and failure histories |

## Development

```bash
git clone https://github.com/edgyarmati/ged-mono.git
cd ged-mono
npm install
npm --prefix packages/gedpi run chat    # launch locally in dev mode
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
- Pushing a `gedpi-v*` tag runs the release workflow, verifies the repo again, publishes to npm through GitHub Actions trusted publishing with provenance, and then creates the GitHub release.
- Trusted publishing still requires npm-side setup for this repository/workflow in the npm package settings.

## Attribution

GedPi builds on the Pi ecosystem. See [CREDITS.md](CREDITS.md).

## License

MIT. See [LICENSE](LICENSE).
