import type { SettingDefinition } from "@juanibiapina/pi-extension-settings";
import { getSetting } from "@juanibiapina/pi-extension-settings";

export type AutoCommitVerifiedWork = "off" | "ask" | "on";
export type ReviewPlanBeforePlannerHandoff = "off" | "on";

export const AUTO_COMMIT_VERIFIED_WORK_DEFAULT: AutoCommitVerifiedWork = "ask";
export const REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT: ReviewPlanBeforePlannerHandoff =
  "on";
export const GEDPI_SETTINGS_EXTENSION_NAME = "gedpi";
export const AUTO_COMMIT_VERIFIED_WORK_SETTING_ID = "autoCommitVerifiedWork";
export const REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_SETTING_ID =
  "reviewPlanBeforePlannerHandoff";

export const GEDPI_EXTENSION_SETTINGS: SettingDefinition[] = [
  {
    id: AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
    label: "Commit after verification",
    description:
      "Controls whether GedPi commits verified work: off leaves changes uncommitted, ask prompts first, on commits after successful verification.",
    defaultValue: AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
    values: ["off", "ask", "on"],
  },
  {
    id: REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_SETTING_ID,
    label: "Review plan before planner handoff",
    description:
      "Controls whether GedPi requires user approval of the draft plan before dispatching ged-planner for non-trivial work.",
    defaultValue: REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT,
    values: ["off", "on"],
  },
];

export type GetSettingFn = (
  extensionName: string,
  settingId: string,
  defaultValue?: string,
) => string | undefined;

export function normalizeAutoCommitVerifiedWork(
  value: unknown,
): AutoCommitVerifiedWork {
  return value === "off" || value === "on" || value === "ask"
    ? value
    : AUTO_COMMIT_VERIFIED_WORK_DEFAULT;
}

export function readAutoCommitVerifiedWork(
  getter: GetSettingFn = getSetting,
): AutoCommitVerifiedWork {
  return normalizeAutoCommitVerifiedWork(
    getter(
      GEDPI_SETTINGS_EXTENSION_NAME,
      AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
      AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
    ),
  );
}

export function normalizeReviewPlanBeforePlannerHandoff(
  value: unknown,
): ReviewPlanBeforePlannerHandoff {
  return value === "off" || value === "on"
    ? value
    : REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT;
}

export function readReviewPlanBeforePlannerHandoff(
  getter: GetSettingFn = getSetting,
): ReviewPlanBeforePlannerHandoff {
  return normalizeReviewPlanBeforePlannerHandoff(
    getter(
      GEDPI_SETTINGS_EXTENSION_NAME,
      REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_SETTING_ID,
      REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT,
    ),
  );
}

export function buildAutoCommitWorkflowPrompt(
  preference: AutoCommitVerifiedWork,
): string {
  const instructions = {
    off: "After verification passes, do not commit unless the user explicitly asks. Summarize the verified changes and say they are left uncommitted.",
    ask: "After verification passes, ask the user whether to commit before running git commit.",
    on: "After verification passes and verifier findings are adjudicated, create a conventional git commit without asking for another confirmation.",
  } satisfies Record<AutoCommitVerifiedWork, string>;

  return `## Commit Preference

Current setting: ${preference}

${instructions[preference]}

Always use the normal git command path so checkpoint guards still apply. Never commit before planned checks pass and verifier findings are adjudicated. Never push unless the user explicitly asks.`;
}

export function buildPlanReviewWorkflowPrompt(
  preference: ReviewPlanBeforePlannerHandoff,
): string {
  const instructions = {
    off: "After writing the draft plan for non-trivial work, dispatch ged-planner without asking for separate user approval of the draft plan.",
    on: "After writing the draft plan for non-trivial work and before dispatching ged-planner, show the plan to the user and wait for explicit approval. If the user requests changes, revise the plan, then ask for approval again before planner handoff.",
  } satisfies Record<ReviewPlanBeforePlannerHandoff, string>;

  return `## Plan Review Preference

Current setting: ${preference}

${instructions[preference]}

This preference only affects non-trivial work with subagents enabled. It does not make the subagent workflow mandatory for trivial tasks.`;
}
