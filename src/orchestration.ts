import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import type {
  CheckpointRecord,
  CheckpointState,
  TaskClassification,
} from "./contracts.js";

const CHECKPOINT_FILE = ".ged/runtime/checkpoints.json";

export function initCheckpointState(
  classification: TaskClassification,
  classificationReason: string,
): CheckpointState {
  return {
    classification,
    classificationReason,
    planCheckpoints: {},
    taskCheckpoints: {},
  };
}

export async function readCheckpointState(
  rootDir: string,
): Promise<CheckpointState | null> {
  try {
    const raw = await readFile(path.join(rootDir, CHECKPOINT_FILE), "utf8");
    return JSON.parse(raw) as CheckpointState;
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

export function recordCheckpoint(
  state: CheckpointState,
  record: CheckpointRecord,
  taskId?: string,
): CheckpointState {
  if (taskId) {
    return {
      ...state,
      taskCheckpoints: {
        ...state.taskCheckpoints,
        [taskId]: {
          ...state.taskCheckpoints[taskId],
          [record.agent]: record,
        },
      },
    };
  }
  return {
    ...state,
    planCheckpoints: {
      ...state.planCheckpoints,
      [record.agent]: record,
    },
  };
}

export interface CheckpointValidation {
  valid: boolean;
  missing: string[];
  warning?: string;
}

export function validatePlanCheckpoints(
  state: CheckpointState | null,
): CheckpointValidation {
  if (!state) {
    return {
      valid: true,
      missing: [],
      warning: "No checkpoint state found — subagents may not be enabled",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }
  const missing: string[] = [];
  if (!state.planCheckpoints["ged-planner"]) {
    missing.push("ged-planner");
  }
  return { valid: missing.length === 0, missing };
}

export function validateCommitCheckpoints(
  state: CheckpointState | null,
  taskId: string,
): CheckpointValidation {
  if (!state) {
    return {
      valid: true,
      missing: [],
      warning: "No checkpoint state found — subagents may not be enabled",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }
  const missing: string[] = [];
  if (!state.taskCheckpoints[taskId]?.["ged-verifier"]) {
    missing.push("ged-verifier");
  }
  return { valid: missing.length === 0, missing };
}

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

### Mandatory checkpoints for non-trivial work

When subagents are enabled and the task is non-trivial, use mandatory intelligence checkpoints:

1. **ged-explorer** — Dispatch via the subagent tool for evidence-backed codebase discovery when relevant code context is not already known. Use before planning to understand existing patterns, dependencies, and risks.

2. **ged-planner** — Dispatch via the subagent tool before finalizing or materially changing .ged/SPEC.md, .ged/TASKS.md, or .ged/TESTS.md. The planner critiques your plan and identifies missing context, edge cases, and test seams. You adjudicate the findings and write the final planning files.

3. **ged-verifier** — Dispatch via the subagent tool for clean-context review before committing meaningful implementation changes. The verifier reviews your diff and tests with minimal prior assumptions. You adjudicate each finding (accept, reject, needs-user), fix accepted issues, and rerun verification.

After each subagent completes, record the checkpoint in .ged/runtime/checkpoints.json:
\`\`\`json
{"agent": "ged-verifier", "timestamp": "...", "status": "completed", "findingCount": 2, "blocksCommit": false}
\`\`\`

### Skip policy

If a checkpoint is skipped because the task is trivial, subagents are disabled or unavailable, the call fails, or the user explicitly asks not to delegate, record a checkpoint with status "skipped" and a skip reason. Example:
\`\`\`json
{"agent": "ged-planner", "timestamp": "...", "status": "skipped", "skipReason": "User asked to skip planning critique"}
\`\`\`

### Clean-context review flow (before every meaningful commit)

1. Run all planned checks from .ged/TESTS.md
2. Dispatch ged-verifier for clean-context review of the diff and tests
3. Adjudicate each finding: accept (fix before commit), reject (record reason), or needs-user (ask)
4. Fix accepted issues and rerun verification
5. Record the checkpoint, then commit

### Intercom usage

Use pi-intercom only for child-to-parent clarification when a subagent is blocked on a scope or product decision. Child agents must ask instead of guessing.

There is no writer subagent role. Do not delegate source edits, planning-file ownership, scope decisions, verification adjudication, commits, pushes, or PR decisions to subagents.`;
}
