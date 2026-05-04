import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  CheckpointState,
  CheckpointValidation,
} from "@ged/shared-checkpoints";

import { parseCheckpointState } from "@ged/shared-checkpoints";

import { writeFileAtomic } from "./atomic.js";

// Re-export shared functions for backward compatibility
// Legacy alias: validateCommitCheckpoints = validateAllVerifierCheckpoints
export {
  hasSkipCheckpointMarker,
  initCheckpointState,
  isGitCommitCommand,
  parseCheckpointState,
  recordCheckpoint,
  validateAllVerifierCheckpoints,
  validateAllVerifierCheckpoints as validateCommitCheckpoints,
  validatePlannerCheckpoint,
  validateVerifierCheckpoint,
} from "@ged/shared-checkpoints";

const CHECKPOINT_FILE = ".ged/runtime/checkpoints.json";

// ─── Read / Write ───────────────────────────────────────────────────────

export async function readCheckpointState(
  rootDir: string,
): Promise<CheckpointState | null> {
  try {
    const raw = await readFile(path.join(rootDir, CHECKPOINT_FILE), "utf8");
    return parseCheckpointState(raw);
  } catch {
    return null;
  }
}

export async function writeCheckpointState(
  rootDir: string,
  state: CheckpointState,
): Promise<void> {
  const filePath = path.join(rootDir, CHECKPOINT_FILE);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

// ─── Guard messages ─────────────────────────────────────────────────────

export function plannerGuardMessage(validation: CheckpointValidation): string {
  return `GedCode planner guard: non-trivial work requires dispatching ged-planner before editing source files. Missing checkpoints: ${validation.missing.join(", ")}. Dispatch ged-planner via the subagent tool, or reclassify the task as trivial.`;
}

export function verifierGuardMessage(validation: CheckpointValidation): string {
  return `GedCode verifier guard: non-trivial work requires dispatching ged-verifier before committing. Missing checkpoints: ${validation.missing.join(", ")}. Dispatch ged-verifier via the subagent tool for clean-context review.`;
}

// ─── Auto-recording ─────────────────────────────────────────────────────

export function detectSubagentDispatch(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  if (toolName !== "task" && toolName !== "Task") return null;

  const subagentType = input.subagent_type || input.agent || input.subagentType;
  if (typeof subagentType !== "string") return null;

  if (
    subagentType === "ged-explorer" ||
    subagentType === "ged-planner" ||
    subagentType === "ged-verifier"
  ) {
    return subagentType;
  }
  return null;
}

// ─── Orchestration prompt ───────────────────────────────────────────────

export function buildOrchestrationPrompt(agentsEnabled: boolean): string {
  if (!agentsEnabled) {
    return "";
  }

  return `## Subagent orchestration (mandatory for non-trivial work)

Single-writer invariant: you are the sole active-worktree writer, synthesizer, and decision owner. Subagents inject read-only intelligence; they do not own product decisions, commits, PR decisions, or final verification judgments.

### Task classification (FIRST STEP for every new request)

Before any planning or implementation, classify the incoming request:

- **TRIVIAL**: Questions, documentation-only changes, README edits, config tweaks, single-line formatting fixes, adding comments. Skip the subagent workflow entirely.
- **NON-TRIVIAL**: Feature implementation, bug fixes, refactoring, multi-file changes, architectural work. Mandatory subagent checkpoints apply below.

Write your classification and reason to .ged/runtime/checkpoints.json using:
\`\`\`json
{"classification": "trivial|non-trivial", "classificationReason": "...", "planCheckpoints": {}, "taskCheckpoints": {}}
\`\`\`

### Hard enforcement (structural guards)

Both the planner and verifier checkpoints are now **structurally enforced**:
- The **planner guard** blocks write/edit to source files until ged-planner has been dispatched for non-trivial work.
- The **verifier guard** blocks git commit until ged-verifier has been dispatched for non-trivial work.

These guards are implemented in the tool-call interception layer — they cannot be bypassed by instruction alone. The only way to commit without verification is to set \`workflow.allowCheckpointBypass: true\` in GedCode settings.

### Mandatory checkpoints for non-trivial work

When subagents are enabled and the task is non-trivial, use mandatory intelligence checkpoints:

1. **ged-explorer** — Dispatch via the subagent tool for evidence-backed codebase discovery when relevant code context is not already known. Use before planning to understand existing patterns, dependencies, and risks.

2. **ged-planner** — Dispatch via the subagent tool before finalizing or materially changing .ged/SPEC.md, .ged/TASKS.md, or .ged/TESTS.md. The planner critiques your plan and identifies missing context, edge cases, and test seams. You adjudicate the findings and write the final planning files.

3. **ged-verifier** — Dispatch via the subagent tool for clean-context review before committing meaningful implementation changes. The verifier reviews your diff and tests with minimal prior assumptions. You adjudicate each finding (accept, reject, needs-user), fix accepted issues, and rerun verification.

After each subagent completes, the checkpoint is automatically recorded when you dispatch via the Task tool.

### Clean-context review flow (before every meaningful commit)

1. Run all planned checks from .ged/TESTS.md
2. Dispatch ged-verifier for clean-context review of the diff and tests
3. Adjudicate each finding: accept (fix before commit), reject (record reason), or needs-user (ask)
4. Fix accepted issues and rerun verification
5. Commit — the verifier guard will allow it through

### Intercom usage

Use pi-intercom only for child-to-parent clarification when a subagent is blocked on a scope or product decision. Child agents must ask instead of guessing.

There is no writer subagent role. Do not delegate source edits, planning-file ownership, scope decisions, verification adjudication, commits, pushes, or PR decisions to subagents.`;
}

// ─── Git commit detection ───────────────────────────────────────────────

const execFileAsync = promisify(execFile);

export async function detectRecentCommits(
  rootDir: string,
  withinSeconds: number,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--since=${withinSeconds} seconds ago`,
        "--format=%H",
        "--no-merges",
      ],
      { cwd: rootDir, timeout: 5000 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
