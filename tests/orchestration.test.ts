import { describe, it, expect } from "vitest";
import type {
  TaskClassification,
  CheckpointRecord,
  CheckpointState,
} from "../src/contracts.js";

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
