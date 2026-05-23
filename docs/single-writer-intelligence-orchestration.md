# Main-Owned Intelligence Orchestration

## Purpose

GedPi uses `pi-subagents` and `pi-intercom` to delegate context gathering, planning drafts, critique, verification, and optional implementation slices while keeping the main GedPi brain as the user-facing decision owner.

The rule to preserve is:

> Context and implementation slices can be delegated. Scope decisions, final `.ged` artifacts, verification adjudication, commits, pushes, and PR decisions stay with the primary Ged brain.

## Current decisions

- GedPi bundles `pi-subagents` and `pi-intercom` instead of the legacy `@tintinweb/pi-subagents` package.
- Generic/default agents bundled by `pi-subagents` are hidden by default via `subagents.disableBuiltins: true`; Ged exposes its own roles.
- Main agent clarifies requirements and owns user-facing decisions.
- `ged-explorer` performs read-only code/context and skill-fit reconnaissance.
- `ged-planner` authors draft `SPEC.md`, `TASKS.md`, and `TESTS.md` content from clarified requirements and explorer findings.
- Main agent accepts, edits, or rejects planner drafts and writes final `.ged` artifacts.
- `ged-plan-reviewer` provides optional/risk-based critique after the main agent has accepted/written the draft plan.
- `ged-verifier` performs clean-context review of diffs and verification evidence before commits.
- `ged-worker` is optional and disabled by default. When enabled, it may implement bounded approved slices, including parallel disjoint slices. It must not commit, push, rebase, merge, make product decisions, or replace verifier/main acceptance.
- Intern/ops agent remains deferred/absent.
- `pi-intercom` / `contact_supervisor` is for blocked decisions or progress-changing discoveries, not routine completion handoffs.

## Settings model

Agent settings live outside `.ged/` because `.ged/` is durable workflow memory, not runtime/model configuration.

Use:

- global settings: `~/.gedoc/settings.json`;
- project override: `.gedoc/settings.json`, gitignored;
- runtime Pi suppression: `.pi/settings.json` with `subagents.disableBuiltins: true`.

Representative shape:

```json
{
  "agents": {
    "enabled": true,
    "intercomBridge": true,
    "critiqueMode": "risk-based",
    "defaultModel": {
      "model": "provider/model",
      "thinking": "medium",
      "fallback": ["provider/fallback"]
    },
    "roles": {
      "ged-explorer": { "enabled": true },
      "ged-planner": { "enabled": true, "thinking": "high" },
      "ged-plan-reviewer": { "enabled": true },
      "ged-verifier": { "enabled": true },
      "ged-worker": {
        "enabled": false,
        "maxParallel": 2,
        "preferWorktreeIsolation": false
      }
    }
  }
}
```

Compatibility requirements:

- `agents.enabled` defaults to `false`.
- Missing model settings inherit the invoking/orchestrator model.
- Existing legacy `agents.models` string/object entries remain readable and are merged into role settings.
- Project settings override global settings.
- Unknown roles are ignored/cleaned; `ged-worker` is now a valid optional role.
- Generated `pi-subagents` frontmatter uses the current package contract: required `name`/`description`, plus `fallbackModels`, `systemPromptMode`, `inheritProjectContext`, `inheritSkills`, and `completionGuard`.

## Runtime roles

### `ged-explorer`

Read-only repo and skill-fit discovery. It may read/search files, inspect docs/tests/standards/skills, run safe discovery commands, and report evidence. It must not edit, install skills, write `.ged` plans, commit, push, or make scope decisions.

### `ged-planner`

Planning author. It drafts plan artifacts from clarified requirements and explorer findings. It must refuse with `outcome: refused-needs-clarification` when the dispatch lacks enough goal, audience, scope, constraints, risks, or acceptance criteria. The main brain writes final `.ged` files.

### `ged-plan-reviewer`

Risk reviewer for accepted planner drafts. It separates blockers from non-blocking suggestions and does not implement or rewrite scope on its own.

### `ged-verifier`

Clean-context review and verification support. It reports findings with evidence, confidence, suggested fix, and commit-blocking status. The main brain adjudicates and fixes.

### `ged-worker`

Optional implementation worker, disabled by default and generated only when enabled. Use it only for approved, bounded, low-ambiguity, disjoint slices with a clear verification path. It may edit implementation files but must not run git commit/push/rebase/merge or make product/scope decisions. Parallel workers should target separate slices or file areas; optional worktree isolation may be preferred for safer parallelism.

## Workflow integration

When Ged mode is active:

1. Classify the task.
2. Clarify with the user unless the request is already concrete.
3. Use `ged-explorer` when enabled; otherwise the main brain performs and records fallback discovery.
4. Main brain adjudicates skill findings and performs any mutating project-skill install/create actions.
5. Use `ged-planner` to draft the implementation plan when enabled; otherwise main authors it.
6. Main brain accepts/edits/rejects the draft and writes final `.ged` plan artifacts.
7. Run configured human/Glimpse plan review on the written draft.
8. Run `ged-plan-reviewer` according to critique mode: `off`, `risk-based`, or `always`.
9. Implement one bounded slice at a time, optionally using enabled `ged-worker` for disjoint approved slices.
10. Run planned checks.
11. Use `ged-verifier` when enabled, or explicit main-agent fallback verification when disabled.
12. Main brain adjudicates findings, fixes accepted issues, records progress, and commits.

## Mandatory checkpoints

For non-trivial changes with agents enabled:

- classification and clarification/sufficiency are required before planning;
- `ged-explorer` or a role-disabled fallback is required before source inspection/planning;
- `ged-planner` draft plus main accepted/written plan, or planner-disabled fallback plan, is required before source edits;
- `ged-verifier` or verifier-disabled fallback verification is required before meaningful commits;
- worker completion never satisfies verifier/commit requirements.

Checkpoint recording should use successful `subagent` foreground results and `subagent:async-complete` events. Launch alone does not complete a checkpoint.

## `/ged-agents` setup command

The setup/status UI should show:

- effective `agents.enabled` state;
- global and project settings paths;
- intercom bridge state;
- critique mode;
- per-role enabled state, model, thinking level, and fallback models;
- worker `maxParallel` and worktree preference;
- default builtin suppression state.

Guided setup should use Pi's runtime model registry for primary and fallback model selection and avoid invented model IDs.

## Tests to keep current

- Dependency/package tests: `pi-subagents` and `pi-intercom` are pinned; legacy `@tintinweb/pi-subagents` is absent.
- Runtime path tests: configured extension/skill paths exist.
- Default suppression tests: `subagents.disableBuiltins: true` is written/preserved and generic builtins are hidden.
- Settings merge/migration tests: global/project, legacy `models`, role settings, fallback models, thinking levels, critique mode, intercom bridge, and worker settings.
- Agent generation tests: current `pi-subagents` frontmatter names are emitted and worker is absent until enabled.
- Orchestration tests: planner-authored draft flow, disabled-role fallback, intercom guidance, worker guardrails, and verifier/commit behavior.

## Success criteria

- GedPi exposes Ged-specific roles by default, not generic bundled subagents.
- Planner intelligence authors draft plans while the main brain owns final artifacts.
- Optional worker parallelism is available only when explicitly enabled and documented.
- Subagent/worker results improve throughput without weakening main-agent acceptance, verification, or commit ownership.
