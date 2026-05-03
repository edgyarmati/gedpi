import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckpointRecord, CheckpointState } from "../src/contracts.js";
import {
  initCheckpointState,
  readCheckpointState,
  recordCheckpoint,
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
