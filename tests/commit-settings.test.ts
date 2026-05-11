import { describe, expect, test } from "vitest";

import {
  AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
  AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
  buildAutoCommitWorkflowPrompt,
  GEDPI_EXTENSION_SETTINGS,
  GEDPI_SETTINGS_EXTENSION_NAME,
  normalizeAutoCommitVerifiedWork,
  readAutoCommitVerifiedWork,
} from "../src/commit-settings.js";

describe("commit settings", () => {
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
  });
});
