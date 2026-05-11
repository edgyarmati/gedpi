export interface GedPreferences {
  autoCommitVerifiedWork: "off" | "ask" | "on";
  reviewPlanBeforePlannerHandoff: "off" | "on";
}

export const AUTO_COMMIT_DEFAULT: GedPreferences["autoCommitVerifiedWork"] =
  "ask";
export const REVIEW_PLAN_DEFAULT: GedPreferences["reviewPlanBeforePlannerHandoff"] =
  "on";

export const AUTO_COMMIT_ID = "autoCommitVerifiedWork";
export const REVIEW_PLAN_ID = "reviewPlanBeforePlannerHandoff";

export const DEFAULT_PREFERENCES: GedPreferences = {
  autoCommitVerifiedWork: AUTO_COMMIT_DEFAULT,
  reviewPlanBeforePlannerHandoff: REVIEW_PLAN_DEFAULT,
};

export function normalizeAutoCommitVerifiedWork(
  value: unknown,
): GedPreferences["autoCommitVerifiedWork"] {
  return value === "off" || value === "on" || value === "ask"
    ? value
    : AUTO_COMMIT_DEFAULT;
}

export function normalizeReviewPlanBeforePlannerHandoff(
  value: unknown,
): GedPreferences["reviewPlanBeforePlannerHandoff"] {
  return value === "off" || value === "on" ? value : REVIEW_PLAN_DEFAULT;
}

export interface PreferenceDefinition {
  id: string;
  label: string;
  description: string;
  defaultValue: string;
  values: string[];
}

export const PREFERENCE_DEFINITIONS: PreferenceDefinition[] = [
  {
    id: AUTO_COMMIT_ID,
    label: "Commit after verification",
    description:
      "Controls whether GedPi commits verified work: off leaves changes uncommitted, ask prompts first, on commits after successful verification.",
    defaultValue: AUTO_COMMIT_DEFAULT,
    values: ["off", "ask", "on"],
  },
  {
    id: REVIEW_PLAN_ID,
    label: "Review plan before planner handoff",
    description:
      "Controls whether GedPi requires user approval of the draft plan before dispatching ged-planner for non-trivial work.",
    defaultValue: REVIEW_PLAN_DEFAULT,
    values: ["off", "on"],
  },
];
