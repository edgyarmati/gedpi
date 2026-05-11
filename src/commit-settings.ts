export type AutoCommitVerifiedWork = "off" | "ask" | "on";
export type ReviewPlanBeforePlannerHandoff = "off" | "on";

export {
  AUTO_COMMIT_DEFAULT,
  AUTO_COMMIT_ID,
  DEFAULT_PREFERENCES,
  type GedPreferences,
  normalizeAutoCommitVerifiedWork,
  normalizeReviewPlanBeforePlannerHandoff,
  PREFERENCE_DEFINITIONS,
  type PreferenceDefinition,
  REVIEW_PLAN_DEFAULT,
  REVIEW_PLAN_ID,
} from "./preferences.js";

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
