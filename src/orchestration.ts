import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import type {
  CheckpointRecord,
  CheckpointState,
  TaskClassification,
} from "./contracts.js";

const CHECKPOINT_FILE = ".ged/runtime/checkpoints.json";

export function initCheckpointState(
  classification: TaskClassification,
  classificationReason: string,
): CheckpointState {
  return {
    classification,
    classificationReason,
    planCheckpoints: {},
    taskCheckpoints: {},
  };
}

export async function readCheckpointState(
  rootDir: string,
): Promise<CheckpointState | null> {
  try {
    const raw = await readFile(
      path.join(rootDir, CHECKPOINT_FILE),
      "utf8",
    );
    return JSON.parse(raw) as CheckpointState;
  } catch {
    return null;
  }
}

export async function writeCheckpointState(
  rootDir: string,
  state: CheckpointState,
): Promise<void> {
  const filePath = path.join(rootDir, CHECKPOINT_FILE);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function recordCheckpoint(
  state: CheckpointState,
  record: CheckpointRecord,
  taskId?: string,
): CheckpointState {
  if (taskId) {
    return {
      ...state,
      taskCheckpoints: {
        ...state.taskCheckpoints,
        [taskId]: {
          ...state.taskCheckpoints[taskId],
          [record.agent]: record,
        },
      },
    };
  }
  return {
    ...state,
    planCheckpoints: {
      ...state.planCheckpoints,
      [record.agent]: record,
    },
  };
}
