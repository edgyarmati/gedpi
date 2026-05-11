import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/atomic.js";
import { buildWorkflowPromptSuffix } from "../src/brain.js";
import {
  buildOrchestrationPrompt,
  detectRecentCommits,
  detectSubagentDispatch,
  initCheckpointState,
  invalidateVerifierCheckpoints,
  readCheckpointState,
  recordAutoCheckpoint,
  recordCheckpoint,
  validateCommitCheckpoints,
  validatePlannerCheckpoint,
  validateVerifierCheckpoint,
  writeCheckpointState,
} from "../src/orchestration.js";
import type {
  CheckpointRecord,
  CheckpointState,
} from "../src/vendor/shared-checkpoints.js";

/** Build a valid v2 state with clarification, explorer, and planner (auto). */
function makeValidV2State(
  classification: "trivial" | "non-trivial" = "non-trivial",
): CheckpointState {
  const base = initCheckpointState(classification, "Test setup");
  if (classification === "trivial") return base;

  let state: CheckpointState = {
    ...base,
    clarification: {
      status: "completed",
      source: "manual",
      timestamp: "2026-05-07T10:00:00Z",
      evidence: {
        goal: "Test the checkpoint validation system",
        users: "Engineers working on the GedPi system",
        scope: "Unit tests in the orchestration module",
        constraints: "Must pass CI and be fast",
      },
    },
  };

  state = recordAutoCheckpoint(state, {
    agent: "ged-explorer",
    timestamp: "2026-05-07T10:05:00Z",
    status: "completed",
    findingCount: 5,
  });

  state = recordAutoCheckpoint(state, {
    agent: "ged-planner",
    timestamp: "2026-05-07T10:10:00Z",
    status: "completed",
    findingCount: 3,
  });

  return state;
}

describe("checkpoint types", () => {
  it("CheckpointState has expected shape", () => {
    const state: CheckpointState = {
      schemaVersion: 2,
      classification: "non-trivial",
      classificationReason: "Feature implementation spanning multiple files",
      planCheckpoints: {},
      taskCheckpoints: {},
    };
    expect(state.classification).toBe("non-trivial");
    expect(state.planCheckpoints).toEqual({});
  });

  it("trivial classification skips checkpoint tracking", () => {
    const state: CheckpointState = {
      schemaVersion: 2,
      classification: "trivial",
      classificationReason: "README update",
      planCheckpoints: {},
      taskCheckpoints: {},
    };
    expect(state.classification).toBe("trivial");
  });

  it("CheckpointRecord tracks agent execution", () => {
    const record: CheckpointRecord = {
      agent: "ged-verifier",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
      source: "auto",
      findingCount: 2,
      blocksCommit: false,
    };
    expect(record.agent).toBe("ged-verifier");
    expect(record.status).toBe("completed");
    expect(record.source).toBe("auto");
  });
});

describe("checkpoint state management", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ged-orch-"));
    await mkdir(path.join(tmpDir, ".ged", "runtime"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no checkpoint file exists", async () => {
    const state = await readCheckpointState(tmpDir);
    expect(state).toBeNull();
  });

  it("returns null for malformed checkpoint JSON", async () => {
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "runtime", "checkpoints.json"),
      '{"schemaVersion":2,"classification":"invalid-value"}',
    );
    const state = await readCheckpointState(tmpDir);
    expect(state).toBeNull();
  });

  it("returns null for legacy v1 schema", async () => {
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "runtime", "checkpoints.json"),
      JSON.stringify({
        classification: "non-trivial",
        classificationReason: "v1",
        planCheckpoints: {},
        taskCheckpoints: {},
      }),
    );
    const state = await readCheckpointState(tmpDir);
    expect(state).toBeNull();
  });

  it("returns null for non-object checkpoint JSON", async () => {
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "runtime", "checkpoints.json"),
      '"just a string"',
    );
    const state = await readCheckpointState(tmpDir);
    expect(state).toBeNull();
  });

  it("initializes checkpoint state with classification and schemaVersion", () => {
    const state = initCheckpointState("non-trivial", "Multi-file feature");
    expect(state.schemaVersion).toBe(2);
    expect(state.classification).toBe("non-trivial");
    expect(state.classificationReason).toBe("Multi-file feature");
    expect(state.planCheckpoints).toEqual({});
    expect(state.taskCheckpoints).toEqual({});
  });

  it("round-trips checkpoint state through write and read", async () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    await writeCheckpointState(tmpDir, state);
    const loaded = await readCheckpointState(tmpDir);
    expect(loaded).toEqual(state);
  });

  it("records a plan checkpoint", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const updated = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
      findingCount: 3,
    });
    expect(updated.planCheckpoints["ged-planner"]).toEqual({
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
      findingCount: 3,
    });
    expect(state.planCheckpoints["ged-planner"]).toBeUndefined();
  });

  it("recordAutoCheckpoint stamps source:auto", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const updated = recordAutoCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
    });
    expect(updated.planCheckpoints["ged-planner"]?.source).toBe("auto");
  });

  it("recordCheckpoint does NOT stamp source:auto", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const updated = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
    });
    expect(updated.planCheckpoints["ged-planner"]?.source).toBeUndefined();
  });

  it("records a task checkpoint", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const updated = recordCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-04T11:00:00Z",
        status: "completed",
        findingCount: 0,
        blocksCommit: false,
      },
      "T04",
    );
    expect(updated.taskCheckpoints.T04?.["ged-verifier"]).toEqual({
      agent: "ged-verifier",
      timestamp: "2026-05-04T11:00:00Z",
      status: "completed",
      findingCount: 0,
      blocksCommit: false,
    });
  });

  it("records a skipped checkpoint with reason", () => {
    const state = initCheckpointState("trivial", "README update");
    const updated = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "skipped",
      skipReason: "Task classified as trivial",
    });
    expect(updated.planCheckpoints["ged-planner"]?.status).toBe("skipped");
    expect(updated.planCheckpoints["ged-planner"]?.skipReason).toBe(
      "Task classified as trivial",
    );
  });

  it("recordCheckpoint overwrites existing entries", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const withCompleted = recordAutoCheckpoint(state, {
      agent: "ged-explorer",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
    });
    const withSkipped = recordAutoCheckpoint(withCompleted, {
      agent: "ged-explorer",
      timestamp: "2026-05-04T10:05:00Z",
      status: "skipped",
      skipReason: "redundant",
    });
    // Latest write overwrites — even from completed to skipped
    expect(withSkipped.planCheckpoints["ged-explorer"]?.status).toBe("skipped");
  });
});

describe("checkpoint validation", () => {
  it("plan validation passes with valid v2 state", () => {
    const state = makeValidV2State();
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("plan validation fails without clarification", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("clarification");
  });

  it("plan validation fails without explorer", () => {
    const state = makeValidV2State();
    // Remove explorer
    const { "ged-explorer": _, ...rest } = state.planCheckpoints;
    const noExplorer = { ...state, planCheckpoints: rest };
    const result = validatePlannerCheckpoint(noExplorer);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-explorer (auto-recorded)");
  });

  it("plan validation fails when planner lacks source:auto", () => {
    const state = makeValidV2State();
    // Replace planner with manual version
    const manualPlanner = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-07T10:15:00Z",
      status: "completed",
    });
    const result = validatePlannerCheckpoint(manualPlanner);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-planner (not auto-recorded)");
  });

  it("plan validation fails when planner refused for clarification", () => {
    const state = makeValidV2State();
    const plannerRecord = state.planCheckpoints["ged-planner"];
    expect(plannerRecord).toBeDefined();
    if (!plannerRecord) return;

    const refused: CheckpointState = {
      ...state,
      planCheckpoints: {
        ...state.planCheckpoints,
        "ged-planner": {
          ...plannerRecord,
          outcome: "refused-needs-clarification",
        },
      },
    };

    const result = validatePlannerCheckpoint(refused);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(
      "ged-planner (outcome: refused-needs-clarification)",
    );
    expect(validateCommitCheckpoints(refused).valid).toBe(false);
  });

  it("plan validation fails when planner is blocked", () => {
    const base = initCheckpointState("non-trivial", "Feature work");
    let state: CheckpointState = {
      ...base,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: "2026-05-07T10:00:00Z",
        evidence: {
          goal: "Test",
          users: "Engineers working on GedPi",
          scope: "Unit test suite",
          constraints: "Must pass CI checks",
        },
      },
    };
    state = recordAutoCheckpoint(state, {
      agent: "ged-explorer",
      timestamp: "2026-05-07T10:05:00Z",
      status: "completed",
    });
    state = recordAutoCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-07T10:10:00Z",
      status: "blocked",
    });
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(
      "ged-planner (status is blocked, not completed)",
    );
  });

  it("plan validation accepts explorer skipped with reason", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    let withClarification: CheckpointState = {
      ...state,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: "2026-05-07T10:00:00Z",
        evidence: {
          goal: "Docs update",
          users: "All project contributors",
          scope: "README and documentation files",
          constraints: "No specific constraints",
        },
      },
    };
    withClarification = recordAutoCheckpoint(withClarification, {
      agent: "ged-explorer",
      timestamp: "2026-05-07T10:05:00Z",
      status: "skipped",
      skipReason: "Documentation-only task, no source inspection needed",
    });
    withClarification = recordAutoCheckpoint(withClarification, {
      agent: "ged-planner",
      timestamp: "2026-05-07T10:10:00Z",
      status: "completed",
    });
    const result = validatePlannerCheckpoint(withClarification);
    expect(result.valid).toBe(true);
  });

  it("plan validation fails when explorer skipped without reason", () => {
    // Build state without the pre-existing completed explorer from helper
    const base = initCheckpointState("non-trivial", "Feature work");
    let state: CheckpointState = {
      ...base,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: "2026-05-07T10:00:00Z",
        evidence: {
          goal: "Test",
          users: "Engineers working on GedPi",
          scope: "Unit test suite",
          constraints: "Must pass CI checks",
        },
      },
    };
    state = recordAutoCheckpoint(state, {
      agent: "ged-explorer",
      timestamp: "2026-05-07T10:05:00Z",
      status: "skipped",
      // No skipReason — invalid
    });
    state = recordAutoCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-07T10:10:00Z",
      status: "completed",
    });
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-explorer (skipped without reason)");
  });

  it("plan validation fails for missing clarification evidence fields", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const bad: CheckpointState = {
      ...state,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: "2026-05-07T10:00:00Z",
        evidence: {
          goal: "",
          users: "N/A",
          scope: "todo",
          constraints: ".",
        },
      },
    };
    const result = validatePlannerCheckpoint(bad);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("clarification.evidence.goal");
    expect(result.missing).toContain("clarification.evidence.users");
    expect(result.missing).toContain("clarification.evidence.constraints");
  });

  it("plan validation passes for trivial classification", () => {
    const state = makeValidV2State("trivial");
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(true);
  });

  it("verifier validation passes with auto-recorded verifier", () => {
    const state = makeValidV2State();
    const withVerifier = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "completed",
        findingCount: 0,
        blocksCommit: false,
      },
      "T01",
    );
    const result = validateVerifierCheckpoint(withVerifier, "T01");
    expect(result.valid).toBe(true);
  });

  it("verifier validation fails without source:auto", () => {
    const state = makeValidV2State();
    const withVerifier = recordCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "completed",
        findingCount: 0,
        blocksCommit: false,
      },
      "T01",
    );
    const result = validateVerifierCheckpoint(withVerifier, "T01");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-verifier (not auto-recorded)");
  });

  it("commit validation fails when verifier missing for non-trivial", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const result = validateVerifierCheckpoint(state, "T04");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-verifier");
  });

  it("commit validation passes for trivial classification", () => {
    const state = makeValidV2State("trivial");
    const result = validateVerifierCheckpoint(state, "T01");
    expect(result.valid).toBe(true);
  });

  it("verifier validation fails when verifier is skipped", () => {
    const state = makeValidV2State();
    const withSkip = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "skipped",
        skipReason: "Trivial",
      },
      "T01",
    );
    const result = validateVerifierCheckpoint(withSkip, "T01");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(
      "ged-verifier (status is skipped, not completed)",
    );
  });

  it("validation returns invalid when no checkpoint state", () => {
    const result = validatePlannerCheckpoint(null);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("classification");
    expect(result.warning).toContain("classify the task");
  });

  it("commit validation blocks non-trivial work without planner or verifier", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const result = validateCommitCheckpoints(state);
    expect(result.valid).toBe(false);
    // v2 validation lists clarification + explorer + planner + verifier
    expect(result.missing).toContain("clarification");
  });

  it("commit validation allows valid v2 non-trivial work", () => {
    let state = makeValidV2State();
    state = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "completed",
        blocksCommit: false,
      },
      "T01",
    );
    const result = validateCommitCheckpoints(state);
    expect(result.valid).toBe(true);
  });

  it("commit validation blocks verifier checkpoints that report blockers", () => {
    let state = makeValidV2State();
    state = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "completed",
        blocksCommit: true,
      },
      "T01",
    );
    const result = validateCommitCheckpoints(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-verifier blocked commit (task T01)");
  });
});

describe("invalidateVerifierCheckpoints", () => {
  it("sets blocksCommit: true on all existing verifier checkpoints", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const state2 = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-04T10:00:00Z",
        status: "completed",
        blocksCommit: false,
        findingCount: 0,
      },
      "T01",
    );
    const state3 = recordAutoCheckpoint(
      state2,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-04T11:00:00Z",
        status: "completed",
        blocksCommit: false,
        findingCount: 0,
      },
      "T02",
    );

    const invalidated = invalidateVerifierCheckpoints(state3);
    expect(
      invalidated.taskCheckpoints.T01?.["ged-verifier"]?.blocksCommit,
    ).toBe(true);
    expect(
      invalidated.taskCheckpoints.T02?.["ged-verifier"]?.blocksCommit,
    ).toBe(true);
  });

  it("leaves non-verifier checkpoints untouched", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const withExplorer = recordAutoCheckpoint(
      state,
      {
        agent: "ged-explorer",
        timestamp: "2026-05-04T10:00:00Z",
        status: "completed",
      },
      "T01",
    );

    const invalidated = invalidateVerifierCheckpoints(withExplorer);
    expect(
      invalidated.taskCheckpoints.T01?.["ged-explorer"]?.blocksCommit,
    ).toBeUndefined();
  });

  it("blocks commit after invalidation", () => {
    let state = makeValidV2State();
    state = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-07T11:00:00Z",
        status: "completed",
        blocksCommit: false,
        findingCount: 0,
      },
      "T01",
    );

    expect(validateCommitCheckpoints(state).valid).toBe(true);

    const invalidated = invalidateVerifierCheckpoints(state);
    const result = validateCommitCheckpoints(invalidated);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-verifier blocked commit (task T01)");
  });
});

describe("subagent dispatch detection", () => {
  it("recognizes tintinweb Agent calls for Ged roles", () => {
    expect(
      detectSubagentDispatch("Agent", { subagent_type: "ged-planner" }),
    ).toBe("ged-planner");
    expect(
      detectSubagentDispatch("Agent", { subagent_type: "GED-VERIFIER" }),
    ).toBe("ged-verifier");
  });

  it("rejects legacy task/subagent shapes", () => {
    expect(detectSubagentDispatch("Task", { agent: "ged-explorer" })).toBe(
      null,
    );
    expect(
      detectSubagentDispatch("subagent", { subagentType: "ged-planner" }),
    ).toBe(null);
    expect(detectSubagentDispatch("Agent", { agent: "ged-planner" })).toBe(
      null,
    );
  });

  it("ignores unknown roles and tools", () => {
    expect(detectSubagentDispatch("Agent", { subagent_type: "worker" })).toBe(
      null,
    );
    expect(
      detectSubagentDispatch("bash", { subagent_type: "ged-planner" }),
    ).toBe(null);
  });
});

describe("orchestration prompt", () => {
  it("returns empty string when agents disabled", () => {
    const result = buildOrchestrationPrompt(false);
    expect(result).toBe("");
  });

  it("includes single-writer invariant when enabled", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("Single-writer invariant");
  });

  it("includes task classification instructions", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("TRIVIAL");
    expect(result).toContain("NON-TRIVIAL");
    expect(result).toContain("execute directly and skip the subagent workflow");
  });

  it("names all three mandatory checkpoints", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("ged-explorer");
    expect(result).toContain("ged-planner");
    expect(result).toContain("ged-verifier");
  });

  it("requires grill-me after planner clarification refusal", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("refused-needs-clarification");
    expect(result).toContain("run a main-agent grill-me session");
    expect(result).toContain(
      "Do not dismiss the planner's clarification request",
    );
  });

  it("includes hard enforcement section", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("Classification is required");
    expect(result).toContain("structurally guarded");
  });

  it("includes clean-context review instructions", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("clean-context review");
    expect(result).toContain("adjudicate");
  });

  it("references Agent tool for dispatch", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("Agent");
    expect(result).toContain("get_subagent_result");
  });

  it("references checkpoint state file", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("checkpoints.json");
  });

  it("does not route normal workflow through pi-intercom", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("Do not rely on pi-intercom");
  });
});

describe("brain orchestration integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ged-brain-orch-"));
    await mkdir(path.join(tmpDir, ".ged"), { recursive: true });
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "STATE.md"),
      "Current phase: plan\nActive task: T01\nStatus summary: planning\nBlockers: None\nNext step: implement\n",
    );
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "TASKS.md"),
      "| ID | Title |\n|---|---|\n| T01 | Test |\n",
    );
    await writeFileAtomic(
      path.join(tmpDir, ".ged", "TESTS.md"),
      "## Checks\n- npm test\n",
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes orchestration prompt when agents enabled", async () => {
    await mkdir(path.join(tmpDir, ".gedcode"), { recursive: true });
    await writeFileAtomic(
      path.join(tmpDir, ".gedcode", "settings.json"),
      JSON.stringify({ agents: { enabled: true } }),
    );
    const suffix = await buildWorkflowPromptSuffix(tmpDir);
    expect(suffix).toContain("Subagent orchestration");
    expect(suffix).toContain("Single-writer invariant");
  });

  it("omits orchestration prompt when agents disabled", async () => {
    await mkdir(path.join(tmpDir, ".gedcode"), { recursive: true });
    await writeFileAtomic(
      path.join(tmpDir, ".gedcode", "settings.json"),
      JSON.stringify({ agents: { enabled: false } }),
    );
    const suffix = await buildWorkflowPromptSuffix(tmpDir);
    expect(suffix).not.toContain("Subagent orchestration");
  });

  it("omits orchestration prompt when no settings file", async () => {
    const suffix = await buildWorkflowPromptSuffix(tmpDir, {
      homeDir: tmpDir,
    });
    expect(suffix).not.toContain("Subagent orchestration");
  });
});

describe("commit detection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ged-git-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array in non-git directory", async () => {
    const commits = await detectRecentCommits(tmpDir, 60);
    expect(commits).toEqual([]);
  });
});

describe("orchestration integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ged-orch-int-"));
    await mkdir(path.join(tmpDir, ".ged", "runtime"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("full non-trivial v2 workflow: classification → clarification → explorer → planner → verifier → commit", async () => {
    let state = initCheckpointState("non-trivial", "Add user authentication");

    // Step 1: Before clarification, planner validation fails
    const planCheck1 = validatePlannerCheckpoint(state);
    expect(planCheck1.valid).toBe(false);
    expect(planCheck1.missing).toContain("clarification");

    // Step 2: Add clarification
    state = {
      ...state,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: new Date().toISOString(),
        evidence: {
          goal: "Add authentication",
          users: "End users",
          scope: "Login and registration flow",
          constraints: "Must use OAuth 2.0 providers",
        },
      },
    };

    // Step 3: Auto-record explorer
    state = recordAutoCheckpoint(state, {
      agent: "ged-explorer",
      timestamp: new Date().toISOString(),
      status: "completed",
      findingCount: 5,
    });

    // Step 4: Auto-record planner
    state = recordAutoCheckpoint(state, {
      agent: "ged-planner",
      timestamp: new Date().toISOString(),
      status: "completed",
      findingCount: 3,
    });
    await writeCheckpointState(tmpDir, state);

    // Now planner validation passes
    expect(validatePlannerCheckpoint(state).valid).toBe(true);

    // Step 5: Verifier required for commit
    const commitCheck1 = validateVerifierCheckpoint(state, "T01");
    expect(commitCheck1.valid).toBe(false);

    state = recordAutoCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: new Date().toISOString(),
        status: "completed",
        findingCount: 0,
        blocksCommit: false,
      },
      "T01",
    );
    await writeCheckpointState(tmpDir, state);

    // Now commit validation passes
    expect(validateCommitCheckpoints(state).valid).toBe(true);

    const persisted = await readCheckpointState(tmpDir);
    expect(persisted?.schemaVersion).toBe(2);
    expect(persisted?.classification).toBe("non-trivial");
    expect(persisted?.planCheckpoints["ged-explorer"]?.source).toBe("auto");
    expect(persisted?.planCheckpoints["ged-planner"]?.source).toBe("auto");
    expect(persisted?.taskCheckpoints.T01?.["ged-verifier"]?.source).toBe(
      "auto",
    );
  });

  it("full trivial workflow: init → all validations pass without checkpoints", async () => {
    const state = initCheckpointState("trivial", "Fix typo in README");
    await writeCheckpointState(tmpDir, state);

    expect(validatePlannerCheckpoint(state).valid).toBe(true);
    expect(validateVerifierCheckpoint(state, "T01").valid).toBe(true);
    expect(validateCommitCheckpoints(state).valid).toBe(true);
  });

  it("manual checkpoints without source:auto are rejected", async () => {
    let state = initCheckpointState("non-trivial", "Feature work");
    state = {
      ...state,
      clarification: {
        status: "completed",
        source: "manual",
        timestamp: "2026-05-07T10:00:00Z",
        evidence: {
          goal: "Test",
          users: "Engineers working on GedPi",
          scope: "Unit test suite",
          constraints: "Must pass CI checks",
        },
      },
    };
    state = recordCheckpoint(state, {
      agent: "ged-explorer",
      timestamp: "2026-05-07T10:05:00Z",
      status: "completed",
    });
    state = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-07T10:10:00Z",
      status: "completed",
    });

    // Manual checkpoints without source:auto are rejected
    const result = validatePlannerCheckpoint(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-explorer (not auto-recorded)");
    expect(result.missing).toContain("ged-planner (not auto-recorded)");
  });
});
