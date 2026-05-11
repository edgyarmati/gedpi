import { describe, expect, test } from "vitest";

import {
  AUTO_COMMIT_DEFAULT,
  AUTO_COMMIT_ID,
  buildAutoCommitWorkflowPrompt,
  buildPlanReviewWorkflowPrompt,
  normalizeAutoCommitVerifiedWork,
  normalizeReviewPlanBeforePlannerHandoff,
  PREFERENCE_DEFINITIONS,
  REVIEW_PLAN_DEFAULT,
  REVIEW_PLAN_ID,
} from "../src/commit-settings.js";

describe("commit settings", () => {
  test("normalizes plan-review preference", () => {
    expect(normalizeReviewPlanBeforePlannerHandoff("off")).toBe("off");
    expect(normalizeReviewPlanBeforePlannerHandoff("on")).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff("ask")).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff(undefined)).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff("invalid")).toBe("on");
  });

  test("normalizes auto-commit preference", () => {
    expect(normalizeAutoCommitVerifiedWork("off")).toBe("off");
    expect(normalizeAutoCommitVerifiedWork("ask")).toBe("ask");
    expect(normalizeAutoCommitVerifiedWork("on")).toBe("on");
    expect(normalizeAutoCommitVerifiedWork(undefined)).toBe("ask");
    expect(normalizeAutoCommitVerifiedWork("invalid")).toBe("ask");
  });

  test("exports preference definitions for UI rendering", () => {
    expect(PREFERENCE_DEFINITIONS).toEqual([
      expect.objectContaining({
        id: AUTO_COMMIT_ID,
        label: "Commit after verification",
        defaultValue: AUTO_COMMIT_DEFAULT,
        values: ["off", "ask", "on"],
      }),
      expect.objectContaining({
        id: REVIEW_PLAN_ID,
        label: "Review plan before planner handoff",
        defaultValue: REVIEW_PLAN_DEFAULT,
        values: ["off", "on"],
      }),
    ]);
  });

  test("re-exports constants", () => {
    expect(AUTO_COMMIT_ID).toBe("autoCommitVerifiedWork");
    expect(REVIEW_PLAN_ID).toBe("reviewPlanBeforePlannerHandoff");
    expect(AUTO_COMMIT_DEFAULT).toBe("ask");
    expect(REVIEW_PLAN_DEFAULT).toBe("on");
  });

  test("builds prompt instructions for each preference", () => {
    expect(buildAutoCommitWorkflowPrompt("off")).toContain(
      "do not commit unless the user explicitly asks",
    );
    expect(buildAutoCommitWorkflowPrompt("ask")).toContain(
      "ask the user whether to commit",
    );
    expect(buildAutoCommitWorkflowPrompt("on")).toContain(
      "create a conventional git commit without asking",
    );
    expect(buildPlanReviewWorkflowPrompt("off")).toContain(
      "dispatch ged-planner without asking",
    );
    expect(buildPlanReviewWorkflowPrompt("on")).toContain(
      "wait for explicit approval",
    );
  });
});
