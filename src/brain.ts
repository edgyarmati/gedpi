import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { readEffectiveGedAgentsSettings } from "./agent-settings.js";
import type { GedState } from "./contracts.js";
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
1. Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
2. Before editing code, make sure the durable project notes in .ged/ reflect the current understanding.
3. Break the requested work into bounded, verifiable slices in .ged/TASKS.md before implementation.
4. Implement one slice at a time.
5. Run the planned checks, record progress in .ged/STATE.md and .ged/SESSION-SUMMARY.md, and tighten the plan if a slice fails.
`;

const BRAIN_SYSTEM_APPEND_WITH_SUBAGENTS = `## GedPi Single-Brain Mode (subagents ACTIVE)

You are GedPi's only user-facing brain. Subagents are enabled and their use is MANDATORY — not optional, not "nice to have." You MUST dispatch them as described below. Skipping subagent dispatch without writing a skip record is a workflow violation.

CRITICAL RULE: You are NOT ALLOWED to write, edit, or create source files until you have:
1. Written a task classification to .ged/runtime/checkpoints.json
2. For non-trivial tasks: dispatched ged-explorer and ged-planner with the Agent tool

If you catch yourself about to write code without having dispatched subagents, STOP and dispatch them first.

Your workflow is mandatory — follow every numbered step in order:
1. Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
2. IMMEDIATELY classify the task by writing to .ged/runtime/checkpoints.json (see orchestration section). Any task that involves creating, modifying, or designing code/files is NON-TRIVIAL. Only pure questions, typo fixes, and config value changes are trivial.
3. Dispatch **ged-explorer** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-explorer", prompt: "<what to investigate>", description: "Explore codebase", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The explorer scouts the codebase and returns findings. Use these findings to inform your plan.
4. Update the durable project notes in .ged/ with the current understanding.
5. Write your plan: break the work into bounded, verifiable slices in .ged/TASKS.md.
6. Dispatch **ged-planner** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-planner", prompt: "<summarize the plan and ask for critique>", description: "Critique plan", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The planner critiques your plan. Adjudicate the feedback and update .ged/TASKS.md.
7. Implement one slice at a time.
8. Before committing, dispatch **ged-verifier** with the Agent tool in background, then retrieve the result: \`Agent({ subagent_type: "ged-verifier", prompt: "<summarize what changed and ask for review>", description: "Verify diff", run_in_background: true })\`, then \`get_subagent_result({ agent_id: "<id>", wait: true })\`. The verifier reviews your diff. Adjudicate each finding, fix accepted issues.
9. Commit. Record progress in .ged/STATE.md and .ged/SESSION-SUMMARY.md.

For TRIVIAL tasks only: skip steps 3, 6, and 8 — but you MUST still write the classification in step 2.
`;

const BRAIN_BEHAVIOR_RULES = `
Behavior rules:
- Stay friendly, plain-spoken, direct, and efficient with tokens/context.
- Do not expose internal handoffs or legacy role concepts. Everything happens behind the scenes.
- If the request is not fully clear enough to implement safely without guessing, use the interview tool to ask targeted clarification questions instead of asking them in chat.
- Do not start editing code until the spec is explicit enough to avoid guessing.
- In this repo, treat direct user instructions as requested Ged app/product behavior by default unless the user explicitly marks them as meta instructions for the agent/session.
- Keep documentation current in .ged/PROJECT.md, .ged/SPEC.md, .ged/TASKS.md, .ged/TESTS.md, and .ged/DECISIONS.md when relevant.
- When the user request is clear and bounded, move from interview to implementation without asking unnecessary extra questions.
`;

function buildBrainSystemAppend(agentsEnabled: boolean): string {
  const base = agentsEnabled
    ? BRAIN_SYSTEM_APPEND_WITH_SUBAGENTS
    : BRAIN_SYSTEM_APPEND_SOLO;
  return base + BRAIN_BEHAVIOR_RULES;
}

const PASSIVE_FILES = [
  "PROJECT.md",
  "SPEC.md",
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
  const [tasks, tests] = await Promise.all([
    readOptional(path.join(cwd, ".ged", "TASKS.md")),
    readOptional(path.join(cwd, ".ged", "TESTS.md")),
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

### .ged/TASKS.md
${clipSection(tasks, 1600)}

### .ged/TESTS.md
${clipSection(tests, 1200)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildBrainSystemPromptSuffix(
  cwd: string,
): Promise<string> {
  const passive = await buildPassiveGedPromptSuffix(cwd);
  const workflow = await buildWorkflowPromptSuffix(cwd);
  return [passive, workflow].filter(Boolean).join("\n\n");
}
