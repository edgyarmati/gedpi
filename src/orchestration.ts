import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { writeFileAtomic } from "./atomic.js";
import { activeGedPaths } from "./ged-paths.js";
import type {
  CheckpointState,
  CheckpointValidation,
} from "./vendor/shared-checkpoints.js";
import { parseCheckpointState } from "./vendor/shared-checkpoints.js";

export {
  consumePlannerCheckpoint,
  hasSkipCheckpointMarker,
  initCheckpointState,
  invalidateVerifierCheckpoints,
  isGitCommitCommand,
  parseCheckpointState,
  recordCheckpoint,
  validateAllVerifierCheckpoints,
  validateCommitCheckpoints,
  validatePlannerCheckpoint,
  validateVerifierCheckpoint,
} from "./vendor/shared-checkpoints.js";

// ─── Read / Write ───────────────────────────────────────────────────────

export async function readCheckpointState(
  rootDir: string,
): Promise<CheckpointState | null> {
  try {
    const paths = await activeGedPaths(rootDir);
    const raw = await readFile(paths.checkpointsPath, "utf8");
    return parseCheckpointState(raw);
  } catch {
    return null;
  }
}

export async function writeCheckpointState(
  rootDir: string,
  state: CheckpointState,
): Promise<void> {
  const paths = await activeGedPaths(rootDir);
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFileAtomic(
    paths.checkpointsPath,
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

// ─── Guard messages ─────────────────────────────────────────────────────

export function plannerGuardMessage(validation: CheckpointValidation): string {
  if (validation.missing.includes("classification")) {
    return 'GedPi planner guard: you must classify the task before editing source files. Write your classification to .ged/runtime/<work-id>/checkpoints.json first. Example: {"classification": "trivial", "classificationReason": "...", "planCheckpoints": {}, "taskCheckpoints": {}}';
  }
  return `GedPi planner guard: non-trivial work requires dispatching ged-planner before editing source files. Missing checkpoints: ${validation.missing.join(", ")}. Dispatch ged-planner with the Agent tool, or reclassify the task as trivial.`;
}

export function verifierGuardMessage(validation: CheckpointValidation): string {
  if (validation.missing.includes("classification")) {
    return 'GedPi verifier guard: you must classify the task before committing. Write your classification to .ged/runtime/<work-id>/checkpoints.json first. Example: {"classification": "trivial", "classificationReason": "...", "planCheckpoints": {}, "taskCheckpoints": {}}';
  }
  if (validation.missing.includes("ged-planner")) {
    return `GedPi verifier guard: non-trivial work requires dispatching ged-planner and ged-verifier before committing. Missing checkpoints: ${validation.missing.join(", ")}. Dispatch the missing subagents before running git commit.`;
  }
  if (validation.missing.some((item) => item.includes("blocked commit"))) {
    return `GedPi verifier guard: the verifier checkpoint reports commit-blocking findings. Missing/blocking checkpoints: ${validation.missing.join(", ")}. Resolve and adjudicate verifier findings, then update .ged/runtime/<work-id>/checkpoints.json to set blocksCommit: false on the verifier checkpoint before committing.`;
  }
  return `GedPi verifier guard: non-trivial work requires dispatching ged-verifier before committing. Missing checkpoints: ${validation.missing.join(", ")}. Dispatch ged-verifier with the Agent tool for clean-context review.`;
}

// ─── Auto-recording ─────────────────────────────────────────────────────

export function detectSubagentDispatch(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  if (toolName !== "Agent") return null;

  const subagentType = input.subagent_type;
  if (typeof subagentType !== "string") return null;

  const normalized = subagentType.toLowerCase();
  if (
    normalized === "ged-explorer" ||
    normalized === "ged-planner" ||
    normalized === "ged-verifier"
  ) {
    return normalized;
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

Write your classification and reason to .ged/runtime/<work-id>/checkpoints.json using:
\`\`\`json
{"classification": "trivial|non-trivial", "classificationReason": "...", "planCheckpoints": {}, "taskCheckpoints": {}}
\`\`\`

### Hard enforcement (structural guards)

All source file edits and git commits are **structurally guarded**:

1. **Classification is required** — If \`.ged/runtime/<work-id>/checkpoints.json\` does not exist, **all source file edits and commits are blocked**. You must classify the task and write the state file before editing any source code.
2. **Trivial classification** allows immediate edits and commits — no subagent dispatches needed.
3. **Non-trivial classification** requires clarification when ambiguous, a skill-fit checkpoint before planning, dispatching \`ged-planner\` with the \`Agent\` tool before edits, and both \`ged-planner\` + \`ged-verifier\` before \`git commit\` or \`git commit --amend\`.
4. **Verifier blockers stop commits** — If a verifier checkpoint records \`blocksCommit: true\`, commits are blocked until findings are resolved and adjudicated. After adjudicating, update \`.ged/runtime/<work-id>/checkpoints.json\` to set \`blocksCommit: false\` on the verifier checkpoint. Source file edits automatically invalidate verifier checkpoints, so you must re-run the verifier after fixing code.
5. **Auto-escalation** — If you classify as trivial but touch more than one source file, the system auto-escalates to non-trivial. You must then dispatch ged-planner before continuing.

These guards are implemented in the tool-call interception layer — they cannot be bypassed by instruction alone. The only way to commit without verification is to set \`agents.allowCheckpointBypass: true\` in Ged settings and include \`[skip-checkpoint]\` in the commit command.

### Mandatory checkpoints for non-trivial work

When subagents are enabled and the task is non-trivial, use mandatory intelligence checkpoints:

0. **clarification + skill-fit** — If the request is not fully clear, use \`grill-me\` in chat before planning: one concise question at a time with a recommended answer/default. Then inventory available bundled/project/user skills. If coverage is insufficient, use \`find-skills\`; if no adequate external skill exists and the gap is reusable, create a narrow project-local skill with \`skill-creator\`. Never install global/user skills automatically.

1. **ged-explorer** — Dispatch with the \`Agent\` tool for evidence-backed codebase discovery when relevant code context is not already known. Use before planning to understand existing patterns, dependencies, and risks.

2. **ged-planner** — Dispatch with the \`Agent\` tool before finalizing or materially changing .ged/work/<work-id>/SPEC.md, TASKS.md, or TESTS.md. The planner critiques your plan and identifies missing context, edge cases, and test seams. You adjudicate the findings and write the final planning files.

3. **ged-verifier** — Dispatch with the \`Agent\` tool for clean-context review before committing meaningful implementation changes. The verifier reviews your diff and tests with minimal prior assumptions. You adjudicate each finding (accept, reject, needs-user), fix accepted issues, and rerun verification.

Use \`Agent({ subagent_type: "ged-planner", prompt: "...", description: "...", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\` when you need the result. Background execution lets GedPi record checkpoints from tintinweb/pi-subagents completion events. Do not force foreground Ged role agents unless explicitly instructed.

### Clean-context review flow (before every meaningful commit)

1. Run all planned checks from .ged/work/<work-id>/TESTS.md
2. Dispatch ged-verifier for clean-context review of the diff and tests
3. Adjudicate each finding: accept (fix before commit), reject (record reason), or needs-user (ask)
4. Fix accepted issues and rerun verification
5. Update the verifier checkpoint in \`.ged/runtime/<work-id>/checkpoints.json\` to set \`blocksCommit: false\`
6. Commit — the verifier guard will allow it through

### Subagent communication

GedPi uses tintinweb/pi-subagents for subagent lifecycle, result retrieval, and steering. Do not rely on pi-intercom for normal Ged workflow coordination. If a subagent is blocked, it should return a needs-decision finding; you decide whether to ask the user or rerun/steer the agent.

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
