import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/atomic.js";
import { buildWorkflowPromptSuffix } from "../src/brain.js";
import type { CheckpointRecord, CheckpointState } from "../src/contracts.js";
import {
  buildOrchestrationPrompt,
  detectRecentCommits,
  initCheckpointState,
  readCheckpointState,
  recordCheckpoint,
  validateCommitCheckpoints,
  validatePlanCheckpoints,
  writeCheckpointState,
} from "../src/orchestration.js";

describe("checkpoint types", () => {
  it("CheckpointState has expected shape", () => {
    const state: CheckpointState = {
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
      findingCount: 2,
      blocksCommit: false,
    };
    expect(record.agent).toBe("ged-verifier");
    expect(record.status).toBe("completed");
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

  it("initializes checkpoint state with classification", () => {
    const state = initCheckpointState("non-trivial", "Multi-file feature");
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
    // Original not mutated
    expect(state.planCheckpoints["ged-planner"]).toBeUndefined();
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
});

describe("checkpoint validation", () => {
  it("plan validation passes when ged-planner completed", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const withPlanner = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: "2026-05-04T10:00:00Z",
      status: "completed",
      findingCount: 1,
    });
    const result = validatePlanCheckpoints(withPlanner);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("plan validation fails when ged-planner missing for non-trivial", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const result = validatePlanCheckpoints(state);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-planner");
  });

  it("plan validation passes for trivial classification", () => {
    const state = initCheckpointState("trivial", "README update");
    const result = validatePlanCheckpoints(state);
    expect(result.valid).toBe(true);
  });

  it("commit validation passes when ged-verifier completed", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const withVerifier = recordCheckpoint(
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
    const result = validateCommitCheckpoints(withVerifier, "T04");
    expect(result.valid).toBe(true);
  });

  it("commit validation fails when ged-verifier missing for non-trivial", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const result = validateCommitCheckpoints(state, "T04");
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ged-verifier");
  });

  it("commit validation passes for trivial classification", () => {
    const state = initCheckpointState("trivial", "Config change");
    const result = validateCommitCheckpoints(state, "T01");
    expect(result.valid).toBe(true);
  });

  it("commit validation passes when checkpoint was skipped with reason", () => {
    const state = initCheckpointState("non-trivial", "Feature work");
    const withSkip = recordCheckpoint(
      state,
      {
        agent: "ged-verifier",
        timestamp: "2026-05-04T11:00:00Z",
        status: "skipped",
        skipReason: "User asked to skip",
      },
      "T04",
    );
    const result = validateCommitCheckpoints(withSkip, "T04");
    expect(result.valid).toBe(true);
  });

  it("validation returns warning when no checkpoint state", () => {
    const result = validatePlanCheckpoints(null);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe(
      "No checkpoint state found — subagents may not be enabled",
    );
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
  });

  it("names all three mandatory checkpoints", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("ged-explorer");
    expect(result).toContain("ged-planner");
    expect(result).toContain("ged-verifier");
  });

  it("includes skip policy", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("skip reason");
  });

  it("includes clean-context review instructions", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("clean-context review");
    expect(result).toContain("adjudicate");
  });

  it("references subagent tool for dispatch", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("subagent");
  });

  it("references checkpoint state file", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("checkpoints.json");
  });

  it("includes intercom usage instructions", () => {
    const result = buildOrchestrationPrompt(true);
    expect(result).toContain("pi-intercom");
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
    const suffix = await buildWorkflowPromptSuffix(tmpDir);
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

  it("full non-trivial workflow: init → plan checkpoint → task checkpoint → validate", async () => {
    let state = initCheckpointState("non-trivial", "Add user authentication");
    await writeCheckpointState(tmpDir, state);

    const planCheck = validatePlanCheckpoints(state);
    expect(planCheck.valid).toBe(false);
    expect(planCheck.missing).toContain("ged-planner");

    state = recordCheckpoint(state, {
      agent: "ged-planner",
      timestamp: new Date().toISOString(),
      status: "completed",
      findingCount: 2,
    });
    await writeCheckpointState(tmpDir, state);

    const planCheck2 = validatePlanCheckpoints(state);
    expect(planCheck2.valid).toBe(true);

    const commitCheck = validateCommitCheckpoints(state, "T01");
    expect(commitCheck.valid).toBe(false);
    expect(commitCheck.missing).toContain("ged-verifier");

    state = recordCheckpoint(
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

    const commitCheck2 = validateCommitCheckpoints(state, "T01");
    expect(commitCheck2.valid).toBe(true);

    const persisted = await readCheckpointState(tmpDir);
    expect(persisted?.classification).toBe("non-trivial");
    expect(persisted?.planCheckpoints["ged-planner"]?.status).toBe("completed");
    expect(persisted?.taskCheckpoints["T01"]?.["ged-verifier"]?.status).toBe(
      "completed",
    );
  });

  it("full trivial workflow: init → all validations pass without checkpoints", async () => {
    const state = initCheckpointState("trivial", "Fix typo in README");
    await writeCheckpointState(tmpDir, state);

    expect(validatePlanCheckpoints(state).valid).toBe(true);
    expect(validateCommitCheckpoints(state, "T01").valid).toBe(true);
  });
});
