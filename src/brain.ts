import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { readEffectiveGedAgentsSettings } from "./agent-settings.js";
import type { GedState } from "./contracts.js";
import { activeGedPaths, currentWorkId, relativeGedPath } from "./ged-paths.js";
import { buildOrchestrationPrompt } from "./orchestration.js";
import { ensurePiSettings, loadSavedTheme } from "./theme.js";
import type {
  EnsureCurrentGedResult,
  InitializeGedOptions,
  InitResult,
} from "./workflow.js";
import { ensureGedProjectCurrent, readGedStatus } from "./workflow.js";

const PASSIVE_CONTEXT_APPEND = `## Ged Durable Standards

Treat the following .ged files as durable project guidance, preferences, and prior decisions.
`;

const BRAIN_SYSTEM_APPEND_SOLO = `## GedPi Single-Brain Mode

You are GedPi's only user-facing brain.

Your workflow is mandatory:
1. Clarify ambiguous non-trivial requests with grill-me: ask one concise question at a time in chat with a recommended answer/default. If the request is already clear, skip grilling.
2. Before planning, run a skill-fit checkpoint: inventory available bundled/project/user skills, select relevant skills, use find-skills if coverage is insufficient, and create a narrow project-local skill with skill-creator when no adequate reusable skill exists.
3. Before editing code, make sure the durable project notes in .ged/ reflect the current understanding.
4. Break the requested work into bounded, verifiable slices in .ged/work/<work-id>/TASKS.md before implementation.
5. Implement one slice at a time.
6. Run the planned checks, record progress in .ged/runtime/<work-id>/STATE.md and .ged/runtime/<work-id>/SESSION-SUMMARY.md, and tighten the plan if a slice fails.
`;

const BRAIN_SYSTEM_APPEND_WITH_SUBAGENTS = `## GedPi Single-Brain Mode (subagents ACTIVE)

You are GedPi's only user-facing brain. Subagents are enabled and their use is MANDATORY — not optional, not "nice to have." You MUST dispatch them as described below. Skipping subagent dispatch without writing a skip record is a workflow violation.

CRITICAL RULE: You are NOT ALLOWED to write, edit, or create source files until you have:
1. Written a task classification to .ged/runtime/<work-id>/checkpoints.json
2. For non-trivial tasks: completed clarification/skill-fit when needed, then dispatched ged-explorer and ged-planner with the Agent tool

CRITICAL RULE: For non-trivial work, you are NOT ALLOWED to inspect source files (read, grep, find, or exploratory bash commands) until ged-explorer has completed its initial reconnaissance. You may read .md files and .ged/ files to bootstrap from project memory. Dispatch one or more ged-explorer agents FIRST, wait for their results, then proceed. Only after an explorer checkpoint is recorded may you read source code.

If you catch yourself about to write code without having completed classification, clarification/skill-fit, and subagent checkpoints, STOP and do them first.

Your workflow is mandatory — follow every numbered step in order:
1. IMMEDIATELY classify the task by writing to .ged/runtime/<work-id>/checkpoints.json (see orchestration section). Any task that involves creating, modifying, or designing code/files is NON-TRIVIAL. Only pure questions, typo fixes, and config value changes are trivial.
2. For non-trivial tasks, run the clarification gate before planning when the request is not 100% clear: use grill-me in chat, ask one concise question at a time, include a recommended answer/default, and stop as soon as the task is concrete enough to plan. If the request is already clear, explicitly skip grilling and proceed.
3. For non-trivial tasks, run the skill-fit checkpoint before planning: inventory available bundled/project/user skills, select relevant skills if coverage is sufficient, use find-skills if coverage is insufficient, and create a narrow project-local skill with skill-creator when no adequate external skill exists and the gap is reusable. Never install global/user skills automatically.
4. Dispatch **ged-explorer** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-explorer", prompt: "<what to investigate>", description: "Explore codebase", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The explorer scouts the codebase and returns findings. Use these findings to inform your plan.
5. Update the durable project notes in .ged/ with the current understanding.
6. Write your plan: break the work into bounded, verifiable slices in .ged/work/<work-id>/TASKS.md.
7. Dispatch **ged-planner** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-planner", prompt: "<summarize the plan and ask for critique>", description: "Critique plan", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The planner critiques your plan. Adjudicate the feedback and update the active work TASKS.md.
8. Implement one slice at a time.
9. Before committing, dispatch **ged-verifier** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-verifier", prompt: "<summarize what changed and ask for review>", description: "Verify diff", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The verifier reviews your diff. Adjudicate each finding, fix accepted issues.
10. Commit. Record progress in .ged/runtime/<work-id>/STATE.md and .ged/runtime/<work-id>/SESSION-SUMMARY.md.

For TRIVIAL tasks only: skip steps 2, 3, 4, 7, and 9 — but you MUST still write the classification in step 1.
`;

const BRAIN_BEHAVIOR_RULES = `
Behavior rules:
- Stay friendly, plain-spoken, direct, and efficient with tokens/context.
- Do not expose internal handoffs or legacy role concepts. Everything happens behind the scenes.
- If the request is not fully clear enough to implement safely without guessing, use grill-me in chat: ask exactly one concise question at a time and include a recommended answer/default.
- Do not start editing code until the spec is explicit enough to avoid guessing.
- In this repo, treat direct user instructions as requested Ged app/product behavior by default unless the user explicitly marks them as meta instructions for the agent/session.
- Keep documentation current in .ged/PROJECT.md, active work SPEC.md/TASKS.md/TESTS.md, and .ged/DECISIONS.md when relevant.
- When the user request is clear and bounded, skip grilling and move to skill-fit/planning without asking unnecessary extra questions.
`;

// ─── Branch hygiene nudge ──────────────────────────────────────────────

export const TRUNK_BRANCHES = new Set(["main", "master", "root"]);

export function buildBranchNudge(workId: string): string {
  if (!TRUNK_BRANCHES.has(workId)) return "";

  if (workId === "root") {
    return `## ⚠️ Branch Hygiene

No named Git branch was detected, so GedPi is using the \`root\` work namespace.
Work tracking is less reliable here because unrelated detached/non-branch work can share
\`.ged/work/root/\`. Before making substantial changes, strongly suggest to the user:

    git checkout -b <descriptive-branch-name>`;
  }

  return `## ⚠️ Branch Hygiene

You are on the \`${workId}\` branch. GedPi strongly recommends working in a feature branch
so each piece of work gets a dedicated \`.ged/work/<branch>/\` namespace and the trunk
stays clean. Before making substantial changes, suggest to the user:

    git checkout -b <descriptive-branch-name>`;
}

function buildBrainSystemAppend(agentsEnabled: boolean): string {
  const base = agentsEnabled
    ? BRAIN_SYSTEM_APPEND_WITH_SUBAGENTS
    : BRAIN_SYSTEM_APPEND_SOLO;
  return base + BRAIN_BEHAVIOR_RULES;
}

const PASSIVE_FILES = [
  "PROJECT.md",
  "CONTEXT-MAP.md",
  "ARCHITECTURE.md",
  "PATTERNS.md",
  "GLOSSARY.md",
  "DECISIONS.md",
  "CONFIG.md",
  "SKILLS.md",
  "STANDARDS.md",
] as const;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function renderStateSummary(state: GedState | null): string {
  if (!state) {
    return "No durable GedPi task state exists yet.";
  }

  return [
    `Current phase: ${state.currentPhase}`,
    `Active task: ${state.activeTask}`,
    `Status summary: ${state.statusSummary}`,
    `Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "None"}`,
    `Next step: ${state.nextStep}`,
  ].join("\n");
}

function clipSection(value: string | null, maxChars: number): string {
  if (!value) {
    return "- Missing";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}…`;
}

export interface EnsureGedInitResult {
  status: "initialized" | "migrated" | "existing";
  initResult?: InitResult;
}

export async function ensureGedReady(
  cwd: string,
  options: InitializeGedOptions = {},
): Promise<EnsureGedInitResult> {
  await ensurePiSettings(cwd);
  loadSavedTheme(cwd);
  const result: EnsureCurrentGedResult = await ensureGedProjectCurrent(
    cwd,
    options,
  );
  return result;
}

export async function ensureGedInitializedDetailed(
  cwd: string,
): Promise<EnsureGedInitResult> {
  return ensureGedReady(cwd);
}

export async function ensureGedInitialized(
  cwd: string,
): Promise<"initialized" | "migrated" | "existing"> {
  const result = await ensureGedReady(cwd);
  return result.status;
}

export async function buildPassiveGedPromptSuffix(
  cwd: string,
): Promise<string> {
  const existingFiles = (
    await Promise.all(
      PASSIVE_FILES.map(async (file) => {
        const filePath = path.join(cwd, ".ged", file);
        return (await fileExists(filePath)) ? file : null;
      }),
    )
  ).filter((value): value is (typeof PASSIVE_FILES)[number] => value != null);

  if (existingFiles.length === 0) {
    return "";
  }

  const contents = await Promise.all(
    existingFiles.map((file) => readOptional(path.join(cwd, ".ged", file))),
  );

  const sections = existingFiles.map((file, index) => {
    return `### .ged/${file}\n${clipSection(contents[index], 1400)}`;
  });

  return `${PASSIVE_CONTEXT_APPEND}

## Current Ged Standards

${sections.join("\n\n")}
`;
}

export async function buildWorkflowPromptSuffix(
  cwd: string,
  options: { homeDir?: string } = {},
): Promise<string> {
  const state = await readGedStatus(cwd).catch(() => null);
  const paths = await activeGedPaths(cwd);
  const [tasks, tests] = await Promise.all([
    readOptional(paths.tasksPath),
    readOptional(paths.testsPath),
  ]);

  const agentSettings = await readEffectiveGedAgentsSettings(
    cwd,
    options,
  ).catch(() => null);
  const agentsEnabled = agentSettings?.enabled ?? false;
  const orchestrationPrompt = buildOrchestrationPrompt(agentsEnabled);

  return [
    buildBrainSystemAppend(agentsEnabled),
    orchestrationPrompt,
    `## Current Durable Task State

${renderStateSummary(state)}

## Current Ged Workflow Files

### ${relativeGedPath(cwd, paths.tasksPath)}
${clipSection(tasks, 1600)}

### ${relativeGedPath(cwd, paths.testsPath)}
${clipSection(tests, 1200)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildBrainSystemPromptSuffix(
  cwd: string,
): Promise<string> {
  const workId = await currentWorkId(cwd);
  const branchNudge = buildBranchNudge(workId);
  const passive = await buildPassiveGedPromptSuffix(cwd);
  const workflow = await buildWorkflowPromptSuffix(cwd);
  return [branchNudge, passive, workflow].filter(Boolean).join("\n\n");
}
