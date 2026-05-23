import { formatPreferenceValue } from "./preferences.js";

export type AutoCommitVerifiedWork = "off" | "ask" | "on";
export type ReviewPlanBeforePlannerHandoff = "off" | "chat" | "plannotator";

export {
  AUTO_COMMIT_DEFAULT,
  AUTO_COMMIT_ID,
  DEFAULT_PREFERENCES,
  formatPreferenceValue,
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
    off: "After the planner draft is accepted and the final .ged plan artifacts are written for non-trivial work, continue without separate human approval of the accepted plan.",
    chat: "After the planner draft is accepted and the final .ged plan artifacts are written for non-trivial work, show the accepted plan to the user in chat and wait for explicit approval before implementation. If the user requests changes, revise the plan, then ask for approval again.",
    plannotator:
      "After the planner draft is accepted and the canonical GedPi plan is written in `.ged/work/<work-id>/`, call the `gedpi_plan_review` tool with the path to the plan file (e.g. `.ged/work/<work-id>/TASKS.md`). This opens visual review, preferring a native Glimpse window when available and falling back to Plannotator's browser UI. Wait for the review result — approved, denied with feedback, or timed out. If denied, apply the feedback to the plan files and call `gedpi_plan_review` again. If the tool reports that no visual review surface is available or errors, fall back to chat approval. Do not use /plannotator or plannotator_submit_plan directly.",
  } satisfies Record<ReviewPlanBeforePlannerHandoff, string>;

  return `## Plan Review Preference

Current setting: ${formatPreferenceValue("reviewPlanBeforePlannerHandoff", preference)} (${preference})

${instructions[preference]}

This preference only affects non-trivial work with subagents enabled. It does not make the subagent workflow mandatory for trivial tasks.`;
}
