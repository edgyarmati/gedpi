# Single-Writer Intelligence Orchestration

## Purpose

This is the implementation handoff for bringing the current GedCode orchestration model back into GedPi.

The rule to preserve is:

> Context can be parallelized. Intelligence can be parallelized. Writes, scope decisions, verification judgment, commits, and PR decisions stay with the primary Ged brain.

This replaces any older worker-subagent direction. GedPi should not reintroduce a writer worker, planner owner, expert writer, or shared-worktree multi-agent swarm.

## Final decisions from GedCode

- The primary `gedpi` / GedPi brain is the only active-worktree writer and decision owner.
- Optional subagents are read-only intelligence contributors only.
- Supported roles are exactly:
  - `ged-explorer` — evidence-backed discovery packets.
  - `ged-planner` — smart-friend planning critique and risk review.
  - `ged-verifier` — verification support and clean-context review.
- There is no `ged-worker` or writer subagent role.
- Do not implement branch/worktree-backed writer workers for this pass. If that idea returns later, it needs a separate explicit design and user-facing mode.
- The planner may recommend a plan, but the primary brain writes the actual `.ged/` plan and owns what is accepted.
- The verifier may report findings, but the primary brain adjudicates accepted vs rejected findings and performs fixes.
- Subagents must not edit source, write `.ged/` planning files, run mutating shell commands, commit, push, or open PRs.

## Settings model

Agent settings should live outside `.ged/`, because `.ged/` is durable workflow memory, not runtime/model configuration.

Use:

- global settings: `~/.gedcode/settings.json` or GedPi's equivalent global config path;
- project override: `.gedcode/settings.json`, gitignored;
- never `.ged/` for model settings.

The current settings shape supports string models and richer model objects:

```json
{
  "agents": {
    "enabled": true,
    "defaultModel": "provider/model",
    "models": {
      "ged-explorer": "opencode/nemotron-3-super-free",
      "ged-planner": {
        "model": "openai/gpt-5.5",
        "reasoningEffort": "high"
      },
      "ged-verifier": {
        "model": "openai/gpt-5.5",
        "reasoningEffort": "low"
      }
    }
  }
}
```

Implementation requirements:

- `agents.enabled` defaults to `false`.
- Missing `defaultModel` means subagents inherit the invoking/orchestrator model unless a per-agent model is set.
- `agents.models` may contain either:
  - a model string, e.g. `"provider/model"`; or
  - an object with at least `model`, plus provider-supported options such as `reasoningEffort`.
- Project settings override global settings.
- Unknown/unsupported role keys must be ignored or cleaned during settings writes.
- In particular, stale `ged-worker` entries must not register a subagent or appear in permissions.
- Settings writes should persist only selected user values, not bundled prompt text or default agent definitions.

## Runtime registration

When `agents.enabled` is false, register only the primary Ged agent.

When true, register the three optional intelligence roles:

- `ged-explorer`
- `ged-planner`
- `ged-verifier`

The primary brain may delegate tasks only to these roles. A safe permission shape is:

```json
{
  "task": {
    "*": "deny",
    "ged-explorer": "allow",
    "ged-planner": "allow",
    "ged-verifier": "allow"
  }
}
```

Do not include `ged-worker`.

## Role contracts

### `ged-explorer`

Purpose: read-only repo discovery.

Allowed:

- search files;
- read files;
- inspect docs, tests, standards, and prior plans;
- return concise evidence-backed discovery packets.

Required output:

```md
## Findings
- ...

## Evidence
- `path/to/file.ts:42` — relevant fact

## Risks / edge cases
- ...

## Uncertainty
- ...

## Recommended next inspection
- ...
```

Forbidden: edits, mutating shell commands, planning-file writes, commits, pushes, PRs.

### `ged-planner`

Purpose: smart-friend planning critique.

It helps the primary brain identify missing context, edge cases, test seams, non-goals, and safer slice boundaries.

It should answer broadly enough to catch flaws, but must say what to inspect next rather than inventing facts.

Required output:

```md
## Plan critique
- ...

## Missing questions or constraints
- ...

## Suggested slices
- ...

## Test strategy
- ...

## Risks / non-goals
- ...

## Recommended next inspection
- ...
```

The primary brain decides what to accept and writes `SPEC.md`, `TASKS.md`, and `TESTS.md`.

### `ged-verifier`

Purpose: clean-context review and verification support.

Use after the primary brain implements a slice and runs planned checks.

Required output:

```md
## Verification review

### Findings
- Severity:
- Evidence:
- Suggested fix:
- Confidence:
- Blocks commit: yes/no

## Test/coverage gaps
- ...

## Scope or contract mismatches
- ...
```

The primary brain adjudicates each finding, fixes accepted issues, reruns verification, updates session notes, and commits.

## Workflow integration

GedPi should follow this sequence for change requests when Ged mode is active:

1. Run a collaboration/status checkpoint if branch/work memory exists.
2. Clarify with the user before planning unless the request is already concrete.
3. Run a skill-fit checkpoint.
4. Use `ged-explorer` for codebase discovery when context is needed.
5. Use `ged-planner` for risky or non-trivial planning critique.
6. Primary brain writes/refines `.ged/` planning artifacts.
7. Implement one bounded slice at a time.
8. Run planned checks.
9. Use `ged-verifier` or equivalent clean-context review before meaningful commits.
10. Primary brain adjudicates findings, fixes accepted issues, reruns checks, records progress, and commits.

### Mandatory checkpoints when subagents are enabled

When native subagents are enabled, the above checkpoints are **mandatory for non-trivial change requests**, not merely preferred:

- use `ged-explorer` for evidence-backed discovery when relevant code context is not already known;
- use `ged-planner` before finalizing or materially changing `SPEC.md`, `TASKS.md`, or `TESTS.md`;
- use `ged-verifier` for checks or clean-context review before committing meaningful implementation changes.

Allowed skip reasons: the task is trivial/mechanical, native subagents are disabled, the runtime does not make a subagent available, the subagent call fails, or the user explicitly asks not to delegate. Record the skip reason in the response and active planning or verification notes.

## `/ged-agents` setup command

Add or update a setup command with these actions:

- `status` — show global, project, and effective settings.
- `on` / `off` — enable or disable globally.
- `on --project` / `off --project` — enable or disable the project override.
- `setup` — guided setup.

Guided setup should:

1. Explain the single-writer invariant and mandatory checkpoints before recommending models.
2. Show current settings and any model recommendations file.
3. Try to list available runtime models; if not possible, accept manual `<provider>/<model>` strings. Do not invent model IDs; prefer exact IDs visible in the runtime model list or provided by the user.
4. Ask one question at a time:
   - enable subagents?
   - global or project settings?
   - inherit orchestrator model or choose a shared default?
   - choose optional per-agent models/options?
   - optionally choose provider options by using an object config such as `{ "model": "openai/gpt-5.5", "reasoningEffort": "high" }` instead of a plain model string.
5. Recommend:
   - cheaper/faster model for `ged-explorer`;
   - strongest reasoning model for `ged-planner`;
   - reliable/tool-capable model for `ged-verifier`.
6. Before writing, summarize the exact settings that will be written and confirm ambiguous model IDs.
7. Write only the selected settings values. Preserve object configs when the user selected provider options.
8. Explain that changes take effect after the runtime reloads configuration.

Status display should:

- Show the effective `agents.enabled` state.
- Show global and project settings paths.
- Show the default model or "inherit invoking model".
- Show resolved per-agent configs with model and provider options in human-readable form (not raw JSON).
- Show checkpoint policy: active for non-trivial changes when enabled, inactive when disabled.
- Show model recommendations path if present.

## Environment isolation warning from GedCode

GedCode isolates OpenCode by launching it with `XDG_CONFIG_HOME=~/.config/gedcode`. That successfully protects the user's normal OpenCode config, but it leaked into child shell tools and made unrelated CLIs such as `gh` miss their normal auth config.

GedCode fixed this by having the plugin detect the GedCode-overridden `XDG_CONFIG_HOME` and prefix bash tool commands with `env -u XDG_CONFIG_HOME` so user CLIs see their normal config while OpenCode continues using the isolated config for its own config loading.

If GedPi adds similar isolation, apply the same fix:

- Detect when the runtime has overridden `XDG_CONFIG_HOME` for config isolation.
- Strip the override from tool subprocess commands by prefixing with `env -u XDG_CONFIG_HOME` (or the platform equivalent).
- Do not strip it for runtime-internal config loading — only for generic user-facing tool shells.
- Test that `gh auth status` and similar user CLIs see the user's normal auth/config after the fix.

Acceptance criterion: `gh auth status` and similar user CLIs should see the user's normal auth/config unless a command intentionally opts into the isolated runtime config.

## Tests to add

- Settings merge: defaults, global, project override.
- Settings parser accepts string models and object model configs.
- Object model configs with provider options are preserved through read/write cycles.
- Unknown roles and stale `ged-worker` are ignored/cleaned.
- Disabled agents register no optional subagents.
- Enabled agents register only explorer/planner/verifier.
- Primary brain task permissions deny `*` and allow only the three intelligence roles.
- Prompts for all roles forbid edits and mutating commands.
- `/ged-agents status/on/off/setup` writes only user settings.
- Status display shows resolved per-agent model configs with provider options, not raw JSON.
- Status display shows checkpoint policy as active when enabled, inactive when disabled.
- Status display shows defaultModel fallback for unconfigured agents.
- Setup confirms before writing and preserves object configs.
- Clean-context review output requires evidence, confidence, suggested fix, and block/non-block status.
- Mandatory checkpoint guidance appears in agent prompts and command templates.
- Skip-with-reason guidance appears in agent prompts and command templates.
- Tool subprocesses do not inherit runtime config isolation in a way that breaks user CLI auth.
- `env -u XDG_CONFIG_HOME` prefix is applied to tool shell commands when GedCode-style isolation is detected.

## Success criteria

- GedPi preserves one active-worktree writer: the primary Ged brain.
- Subagents improve discovery, planning, and verification without owning decisions.
- When enabled, subagent checkpoints are mandatory for non-trivial changes with skip-with-reason for trivial/unavailable/disabled cases.
- Model settings support per-agent model strings and richer option objects.
- No writer role is registered, documented, recommended, or permissioned.
- The setup flow makes the no-writer model clear to users.
- Status display shows resolved per-agent configs with provider options and checkpoint policy.
- User CLI config/auth is not broken by runtime config isolation.
