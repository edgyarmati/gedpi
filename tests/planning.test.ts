import { describe, expect, test } from "vitest";

import type { ConversationBrief } from "../src/contracts.js";
import { isRequestRelated, type PlanningContext } from "../src/planning.js";

function brief(overrides: Partial<ConversationBrief> = {}): ConversationBrief {
  return {
    summary: "",
    desiredOutcome: "",
    constraints: [],
    userSignals: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<PlanningContext> = {}): PlanningContext {
  return {
    existingDecisions: [],
    sessionNotes: [],
    priorTitle: "",
    priorScope: [],
    completedTaskIds: [],
    priorTaskSummaries: [],
    ...overrides,
  };
}

describe("isRequestRelated", () => {
  test("returns true when no prior planning context exists", () => {
    expect(isRequestRelated(brief({ summary: "anything" }))).toBe(true);
  });

  test("returns true when prior or current text is empty", () => {
    expect(
      isRequestRelated(
        brief({ summary: "anything goes here" }),
        ctx({ priorTitle: "" }),
      ),
    ).toBe(true);
  });

  test("returns false when token sets are disjoint", () => {
    expect(
      isRequestRelated(
        brief({ summary: "rewrite payment authorization flow" }),
        ctx({
          priorTitle: "build wireless printer dashboard",
          priorScope: ["printer dashboard widgets"],
        }),
      ),
    ).toBe(false);
  });

  test("returns false when only a single token incidentally overlaps", () => {
    // Both mention "users" but the features are unrelated.
    expect(
      isRequestRelated(
        brief({
          summary: "ship invoice export for finance users",
          constraints: ["pdf"],
        }),
        ctx({
          priorTitle: "redesign signup landing page for new users",
          priorScope: ["landing", "signup", "marketing"],
        }),
      ),
    ).toBe(false);
  });

  test("returns true when overlap meets the 34% threshold", () => {
    // Same feature reworded — most tokens overlap.
    expect(
      isRequestRelated(
        brief({
          summary: "improve invoice export pdf rendering for finance",
        }),
        ctx({
          priorTitle: "invoice export pdf rendering tweaks",
          priorScope: ["invoice", "export", "pdf"],
        }),
      ),
    ).toBe(true);
  });

  test("returns true for short follow-ups with a single shared keyword", () => {
    // A short follow-up like "improve auth error handling" only has a
    // handful of meaningful tokens — one solid match should be enough to
    // treat it as related to the prior auth work.
    expect(
      isRequestRelated(
        brief({
          summary: "improve auth error handling",
          desiredOutcome: "auth error handling",
        }),
        ctx({
          priorTitle: "build auth flow",
          priorScope: ["auth flow"],
          priorTaskSummaries: ["T01 (done): lock auth requirements"],
        }),
      ),
    ).toBe(true);
  });
});
