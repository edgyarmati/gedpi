import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { GedState } from "./contracts.js";
import { ensurePiSettings, loadSavedTheme } from "./theme.js";
import type {
  EnsureCurrentGedResult,
  InitializeGedOptions,
  InitResult,
} from "./workflow.js";
import { ensureGedProjectCurrent, readGedStatus } from "./workflow.js";

const PASSIVE_CONTEXT_APPEND = `## Ged Durable Standards

Treat the following .ged files as durable project guidance, preferences, and prior decisions.

When Ged mode is OFF:
- use these files as context only
- follow the standards and decisions recorded there when relevant
- do not resume task execution state from .ged/TASKS.md, .ged/STATE.md, .ged/TESTS.md, or task artifacts
`;

const BRAIN_SYSTEM_APPEND = `## GedPi Single-Brain Mode

You are GedPi's only user-facing brain.

Your workflow is mandatory:
1. Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
2. Before editing code, make sure the durable project notes in .ged/ reflect the current understanding.
3. Break the requested work into bounded, verifiable slices in .ged/TASKS.md before implementation.
4. Implement one slice at a time.
5. Run the planned checks, record progress in .ged/STATE.md and .ged/SESSION-SUMMARY.md, and tighten the plan if a slice fails.

Behavior rules:
- Stay friendly, plain-spoken, direct, and efficient with tokens/context.
- Do not expose internal handoffs or legacy role concepts. Everything happens behind the scenes.
- If the request is not fully clear enough to implement safely without guessing, use the interview tool to ask targeted clarification questions instead of asking them in chat.
- Do not start editing code until the spec is explicit enough to avoid guessing.
- In this repo, treat direct user instructions as requested Ged app/product behavior by default unless the user explicitly marks them as meta instructions for the agent/session.
- Keep documentation current in .ged/PROJECT.md, .ged/SPEC.md, .ged/TASKS.md, .ged/TESTS.md, and .ged/DECISIONS.md when relevant.
- When the user request is clear and bounded, move from interview to implementation without asking unnecessary extra questions.

Optional subagent intelligence:
- When optional Ged subagents are enabled, delegate only read-only intelligence to ged-explorer, ged-planner, and ged-verifier through pi-subagents.
- Use pi-intercom only for child-to-parent clarification, blocked-state updates, or explicit progress coordination; child agents must ask instead of guessing when a product/scope decision is needed.
- Never delegate active-worktree writes, planning-file ownership, scope decisions, verification adjudication, commits, pushes, or PR decisions.
- Do not use or recommend writer roles such as ged-worker, worker, or expert for Ged orchestration.
`;

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

export async function buildWorkflowPromptSuffix(cwd: string): Promise<string> {
  const state = await readGedStatus(cwd).catch(() => null);
  const [tasks, tests] = await Promise.all([
    readOptional(path.join(cwd, ".ged", "TASKS.md")),
    readOptional(path.join(cwd, ".ged", "TESTS.md")),
  ]);

  return `${BRAIN_SYSTEM_APPEND}

## Current Durable Task State

${renderStateSummary(state)}

## Current Ged Workflow Files

### .ged/TASKS.md
${clipSection(tasks, 1600)}

### .ged/TESTS.md
${clipSection(tests, 1200)}
`;
}

export async function buildBrainSystemPromptSuffix(
  cwd: string,
): Promise<string> {
  const passive = await buildPassiveGedPromptSuffix(cwd);
  const workflow = await buildWorkflowPromptSuffix(cwd);
  return [passive, workflow].filter(Boolean).join("\n\n");
}
