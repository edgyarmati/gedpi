/**
 * Shared checkpoint state types and validation for GedCode and GedPi.
 */

export type TaskClassification = "trivial" | "non-trivial";
export type CheckpointAgent = "ged-explorer" | "ged-planner" | "ged-verifier";
export type PlanCheckpointAgent = "ged-explorer" | "ged-planner";
export type TaskCheckpointAgent = "ged-explorer" | "ged-verifier";

export interface CheckpointRecord {
  agent: CheckpointAgent;
  timestamp: string;
  status: "completed" | "skipped";
  skipReason?: string;
  findingCount?: number;
  blocksCommit?: boolean;
}

export interface CheckpointState {
  classification: TaskClassification;
  classificationReason: string;
  planCheckpoints: Partial<Record<PlanCheckpointAgent, CheckpointRecord>>;
  taskCheckpoints: Record<
    string,
    Partial<Record<TaskCheckpointAgent, CheckpointRecord>>
  >;
}

export interface CheckpointValidation {
  valid: boolean;
  missing: string[];
  warning?: string;
}

export function initCheckpointState(
  classification: TaskClassification,
  classificationReason: string,
): CheckpointState;
export function parseCheckpointState(raw: unknown): CheckpointState | null;
export function validatePlannerCheckpoint(
  state: CheckpointState | null,
): CheckpointValidation;
export function validateVerifierCheckpoint(
  state: CheckpointState | null,
  taskId: string,
): CheckpointValidation;
export function validateAllVerifierCheckpoints(
  state: CheckpointState | null,
): CheckpointValidation;
export function validateCommitCheckpoints(
  state: CheckpointState | null,
): CheckpointValidation;
export function recordCheckpoint(
  state: CheckpointState,
  record: CheckpointRecord,
  taskId?: string,
): CheckpointState;
export function invalidateVerifierCheckpoints(
  state: CheckpointState,
): CheckpointState;
export function isGitCommitCommand(command: string): boolean;
export function hasSkipCheckpointMarker(command: string): boolean;
export function shouldAutoEscalate(
  currentClassification: TaskClassification,
  touchedFilePaths: string[],
): boolean;
