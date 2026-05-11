import { describe, expect, test } from "vitest";

import {
  AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
  AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
  buildAutoCommitWorkflowPrompt,
  buildPlanReviewWorkflowPrompt,
  GEDPI_EXTENSION_SETTINGS,
  GEDPI_SETTINGS_EXTENSION_NAME,
  normalizeAutoCommitVerifiedWork,
  normalizeReviewPlanBeforePlannerHandoff,
  REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT,
  REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_SETTING_ID,
  readAutoCommitVerifiedWork,
  readReviewPlanBeforePlannerHandoff,
} from "../src/commit-settings.js";

describe("commit settings", () => {
  test("normalizes plan-review preference", () => {
    expect(normalizeReviewPlanBeforePlannerHandoff("off")).toBe("off");
    expect(normalizeReviewPlanBeforePlannerHandoff("on")).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff("ask")).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff(undefined)).toBe("on");
    expect(normalizeReviewPlanBeforePlannerHandoff("invalid")).toBe("on");
  });

  test("reads plan-review preference via pi-extension-settings getter", () => {
    const calls: unknown[][] = [];
    const value = readReviewPlanBeforePlannerHandoff((...args) => {
      calls.push(args);
      return "off";
    });

    expect(value).toBe("off");
    expect(calls).toEqual([
      [
        GEDPI_SETTINGS_EXTENSION_NAME,
        REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_SETTING_ID,
        REVIEW_PLAN_BEFORE_PLANNER_HANDOFF_DEFAULT,
      ],
    ]);
  });

  test("normalizes auto-commit preference", () => {
    expect(normalizeAutoCommitVerifiedWork("off")).toBe("off");
    expect(normalizeAutoCommitVerifiedWork("ask")).toBe("ask");
    expect(normalizeAutoCommitVerifiedWork("on")).toBe("on");
    expect(normalizeAutoCommitVerifiedWork(undefined)).toBe("ask");
    expect(normalizeAutoCommitVerifiedWork("invalid")).toBe("ask");
  });

  test("reads auto-commit preference via pi-extension-settings getter", () => {
    const calls: unknown[][] = [];
    const value = readAutoCommitVerifiedWork((...args) => {
      calls.push(args);
      return "on";
    });

    expect(value).toBe("on");
    expect(calls).toEqual([
      [
        GEDPI_SETTINGS_EXTENSION_NAME,
        AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
        AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
      ],
    ]);
  });

  test("exports pi-extension-settings definition", () => {
    expect(GEDPI_EXTENSION_SETTINGS).toEqual([
      expect.objectContaining({
        id: "autoCommitVerifiedWork",
        label: "Commit after verification",
        defaultValue: "ask",
        values: ["off", "ask", "on"],
      }),
      expect.objectContaining({
        id: "reviewPlanBeforePlannerHandoff",
        label: "Review plan before planner handoff",
        defaultValue: "on",
        values: ["off", "on"],
      }),
    ]);
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
