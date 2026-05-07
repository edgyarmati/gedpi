/**
 * Shared checkpoint state types and validation for GedCode and GedPi.
 *
 * Both packages use the same .ged/runtime/<work-id>/checkpoints.json schema
 * to ensure the .ged/ memory format stays interchangeable.
 *
 * Schema v2 adds: source provenance, clarification evidence, explorer-first
 * enforcement, planner outcome tracking, and blocked/failed statuses.
 */

// ─── JSDoc type definitions ─────────────────────────────────────────────

/**
 * @typedef {"trivial" | "non-trivial"} TaskClassification
 */

/**
 * @typedef {"ged-explorer" | "ged-planner" | "ged-verifier"} CheckpointAgent
 */

/**
 * @typedef {"ged-explorer" | "ged-planner"} PlanCheckpointAgent
 */

/**
 * @typedef {"ged-explorer" | "ged-verifier"} TaskCheckpointAgent
 */

/**
 * @typedef {"auto" | "manual"} CheckpointSource
 */

/**
 * @typedef {"completed" | "skipped" | "blocked" | "failed"} CheckpointStatus
 */

/**
 * @typedef {"planned" | "refused-needs-clarification"} PlannerOutcome
 */

/**
 * @typedef {Object} CheckpointRecord
 * @property {CheckpointAgent} agent
 * @property {string} timestamp
 * @property {CheckpointStatus} status
 * @property {CheckpointSource} [source]
 * @property {string} [skipReason]
 * @property {PlannerOutcome} [outcome]
 * @property {number} [findingCount]
 * @property {boolean} [blocksCommit]
 */

/**
 * @typedef {Object} ClarificationEvidence
 * @property {string} goal
 * @property {string} users
 * @property {string} scope
 * @property {string} constraints
 */

/**
 * @typedef {Object} ClarificationRecord
 * @property {"completed"} status
 * @property {"manual"} source
 * @property {string} timestamp
 * @property {ClarificationEvidence} evidence
 */

/**
 * @typedef {Object} CheckpointState
 * @property {number} schemaVersion
 * @property {TaskClassification} classification
 * @property {string} classificationReason
 * @property {ClarificationRecord} [clarification]
 * @property {Partial<Record<PlanCheckpointAgent, CheckpointRecord>>} planCheckpoints
 * @property {Record<string, Partial<Record<TaskCheckpointAgent, CheckpointRecord>>>} taskCheckpoints
 */

/**
 * @typedef {Object} CheckpointValidation
 * @property {boolean} valid
 * @property {string[]} missing
 * @property {string} [warning]
 */

// ─── Schema version ─────────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 2;

// ─── Initializers ───────────────────────────────────────────────────────

/**
 * @param {TaskClassification} classification
 * @param {string} classificationReason
 * @returns {CheckpointState}
 */
export function initCheckpointState(classification, classificationReason) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    classification,
    classificationReason,
    planCheckpoints: {},
    taskCheckpoints: {},
  };
}

// ─── Schema version check ───────────────────────────────────────────────

/**
 * Check the schema version of raw checkpoint JSON. Returns status with
 * a migration message for legacy/corrupt files.
 * @param {unknown} raw
 * @returns {{ ok: boolean, version: number | null, error: string | null }}
 */
export function checkSchemaVersion(raw) {
  if (typeof raw !== "string") {
    return { ok: true, version: null, error: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const version =
      typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : null;

    if (version === null || version < 2) {
      return {
        ok: false,
        version,
        error:
          "Checkpoint file uses legacy schema v1. Re-run task classification to create a v2 checkpoint. Existing planner/verifier checkpoints cannot be trusted and must be regenerated. Write a new classification to .ged/runtime/<work-id>/checkpoints.json.",
      };
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      return {
        ok: false,
        version,
        error: `Checkpoint file uses unknown schema v${version}. Update GedPi/GedCode to a version that supports this schema.`,
      };
    }
    return { ok: true, version: CURRENT_SCHEMA_VERSION, error: null };
  } catch {
    return {
      ok: false,
      version: null,
      error:
        "Checkpoint file is corrupt (invalid JSON). Delete it and re-classify the task.",
    };
  }
}

// ─── Validation helpers ─────────────────────────────────────────────────

/**
 * Check whether a string is a non-placeholder value.
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {boolean}
 */
function isValidEvidenceField(value, fieldName) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  // Reject obvious placeholders
  if (["n/a", "unknown", "todo", "tbd", "none", "...", "-"].includes(lower)) {
    return false;
  }
  // Reject single-word answers that are too short to be meaningful
  if (
    fieldName !== "goal" &&
    trimmed.split(/\s+/u).length < 2 &&
    trimmed.length < 20
  ) {
    return false;
  }
  return true;
}

/**
 * Validate a checkpoint record has auto provenance and is complete.
 * @param {CheckpointRecord | undefined} record
 * @param {"completed" | undefined} [requiredStatus]
 * @returns {{ valid: boolean, reason: string }}
 */
function isValidAutoRecord(record, requiredStatus) {
  if (!record) return { valid: false, reason: "missing" };
  if (record.source !== "auto")
    return { valid: false, reason: "not auto-recorded" };
  if (requiredStatus && record.status !== requiredStatus)
    return {
      valid: false,
      reason: `status is ${record.status}, not ${requiredStatus}`,
    };
  return { valid: true, reason: "" };
}

/**
 * Test if a clarifying bit of evidence is fully valid.
 * @param {Record<string, string>} evidence
 * @returns {CheckpointValidation}
 */
function validateClarificationEvidence(evidence) {
  const missing = [];
  if (!evidence || typeof evidence !== "object") {
    return { valid: false, missing: ["clarification.evidence"] };
  }
  for (const field of ["goal", "users", "scope", "constraints"]) {
    if (!isValidEvidenceField(evidence[field], field)) {
      missing.push(`clarification.evidence.${field}`);
    }
  }
  return { valid: missing.length === 0, missing };
}

// ─── Parse / Validate ───────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {value is CheckpointState}
 */
function isValidCheckpointState(value) {
  if (typeof value !== "object" || value === null) return false;
  const obj = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof obj.schemaVersion === "number" &&
    obj.schemaVersion === CURRENT_SCHEMA_VERSION &&
    (obj.classification === "trivial" ||
      obj.classification === "non-trivial") &&
    typeof obj.classificationReason === "string" &&
    typeof obj.planCheckpoints === "object" &&
    obj.planCheckpoints !== null &&
    typeof obj.taskCheckpoints === "object" &&
    obj.taskCheckpoints !== null
  );
}

/**
 * Parse and validate raw checkpoint state. Returns null if missing or invalid.
 * Legacy v1 files return null — checkSchemaVersion gives the migration message.
 * @param {unknown} raw
 * @returns {CheckpointState | null}
 */
export function parseCheckpointState(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return isValidCheckpointState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Check whether the planner checkpoint exists for non-trivial work.
 * v2 requirements: clarification completed + explorer (auto, completed or skipped)
 * + planner (auto, completed, outcome: "planned"). Trivial work skips all checks.
 * Returns valid=false for null state (classification is required before edits).
 * @param {CheckpointState | null} state
 * @returns {CheckpointValidation}
 */
export function validatePlannerCheckpoint(state) {
  if (!state) {
    return {
      valid: false,
      missing: ["classification"],
      warning:
        "No checkpoint state found — classify the task and write .ged/runtime/<work-id>/checkpoints.json before inspecting or editing source files.",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }

  const missing = [];

  // 1. Clarification must be completed
  if (!state.clarification || state.clarification.status !== "completed") {
    missing.push("clarification");
  } else {
    const evidenceCheck = validateClarificationEvidence(
      state.clarification.evidence,
    );
    missing.push(...evidenceCheck.missing);
  }

  // 2. Explorer must have run with auto provenance (completed or skipped with reason)
  const explorerRecord = state.planCheckpoints["ged-explorer"];
  if (!explorerRecord) {
    missing.push("ged-explorer (auto-recorded)");
  } else {
    const explorerCheck = isValidAutoRecord(explorerRecord, undefined);
    if (!explorerCheck.valid) {
      missing.push(`ged-explorer (${explorerCheck.reason})`);
    } else if (
      explorerRecord.status !== "completed" &&
      explorerRecord.status !== "skipped"
    ) {
      missing.push(
        `ged-explorer (status: ${explorerRecord.status}, not completed or skipped)`,
      );
    } else if (
      explorerRecord.status === "skipped" &&
      (!explorerRecord.skipReason ||
        explorerRecord.skipReason.trim().length === 0)
    ) {
      missing.push("ged-explorer (skipped without reason)");
    }
  }

  // 3. Planner must have run with auto provenance, completed, outcome: planned
  const plannerRecord = state.planCheckpoints["ged-planner"];
  if (!plannerRecord) {
    missing.push("ged-planner (auto-recorded)");
  } else {
    const plannerCheck = isValidAutoRecord(plannerRecord, "completed");
    if (!plannerCheck.valid) {
      missing.push(`ged-planner (${plannerCheck.reason})`);
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Check whether the verifier checkpoint exists for a specific task slice.
 * Returns valid=false for null state (classification is required before commits).
 * Returns valid=true for trivial classification (no verifier needed).
 * @param {CheckpointState | null} state
 * @param {string} taskId
 * @returns {CheckpointValidation}
 */
export function validateVerifierCheckpoint(state, taskId) {
  if (!state) {
    return {
      valid: false,
      missing: ["classification"],
      warning:
        "No checkpoint state found — classify the task and write .ged/runtime/<work-id>/checkpoints.json before committing.",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }
  const missing = [];
  const verifierRecord = state.taskCheckpoints[taskId]?.["ged-verifier"];
  if (!verifierRecord) {
    missing.push("ged-verifier");
  } else {
    const check = isValidAutoRecord(verifierRecord, "completed");
    if (!check.valid) {
      missing.push(`ged-verifier (${check.reason})`);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Check verifier checkpoints for ALL task slices that have any checkpoint data.
 * v2 addition: also validates source provenance on verifier records.
 * @param {CheckpointState | null} state
 * @returns {CheckpointValidation}
 */
export function validateAllVerifierCheckpoints(state) {
  if (!state) {
    return {
      valid: false,
      missing: ["classification"],
      warning:
        "No checkpoint state found — classify the task and write .ged/runtime/<work-id>/checkpoints.json before committing.",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }
  const missing = [];
  let sawVerifier = false;
  for (const [taskId, checkpoints] of Object.entries(state.taskCheckpoints)) {
    const verifier = checkpoints?.["ged-verifier"];
    if (!verifier) {
      missing.push(`ged-verifier (task ${taskId})`);
      continue;
    }
    sawVerifier = true;
    const check = isValidAutoRecord(verifier, "completed");
    if (!check.valid) {
      missing.push(`ged-verifier (task ${taskId}: ${check.reason})`);
    } else if (verifier.blocksCommit) {
      missing.push(`ged-verifier blocked commit (task ${taskId})`);
    }
  }
  if (!sawVerifier) {
    missing.push("ged-verifier (auto-recorded)");
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Validate whether it is safe to create or amend a git commit.
 * v2: planner and verifier must have auto provenance.
 * @param {CheckpointState | null} state
 * @returns {CheckpointValidation}
 */
export function validateCommitCheckpoints(state) {
  if (!state) {
    return {
      valid: false,
      missing: ["classification"],
      warning:
        "No checkpoint state found — classify the task and write .ged/runtime/<work-id>/checkpoints.json before committing.",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }

  const missing = [];

  // Planner validation (includes clarification + explorer + planner)
  const plannerValidation = validatePlannerCheckpoint(state);
  missing.push(...plannerValidation.missing);

  // Verifier validation
  const verifierValidation = validateAllVerifierCheckpoints(state);
  missing.push(...verifierValidation.missing);

  return { valid: missing.length === 0, missing };
}

// ─── Source inspection guard ─────────────────────────────────────────────

/**
 * Check whether the explorer checkpoint allows source file inspection.
 * Returns true if the task is trivial or an auto-recorded explorer has run.
 * Used by the tool-call guard to block premature source reads for non-trivial work.
 * @param {CheckpointState | null} state
 * @returns {boolean}
 */
export function hasExplorerClearedInspection(state) {
  if (!state) return false;
  if (state.classification === "trivial") return true;
  const explorerRecord = state.planCheckpoints["ged-explorer"];
  if (!explorerRecord) return false;
  const check = isValidAutoRecord(explorerRecord, undefined);
  if (!check.valid) return false;
  return (
    explorerRecord.status === "completed" ||
    (explorerRecord.status === "skipped" &&
      !!explorerRecord.skipReason &&
      explorerRecord.skipReason.trim().length > 0)
  );
}

/**
 * Determine whether a file path is safe to read before explorer runs.
 * Only .md files and .ged/ directory files are allowed as pre-explorer reads
 * (so the agent can bootstrap from Ged memory).
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSafePreExplorerRead(filePath) {
  const normalized = filePath.replace(/\\/gu, "/");
  return (
    normalized.endsWith(".md") ||
    normalized.includes("/.ged/") ||
    normalized.startsWith(".ged/")
  );
}

// ─── Mutation ───────────────────────────────────────────────────────────

/**
 * Record a checkpoint in the state. Returns a new state object.
 * Does NOT stamp source:"auto" — use recordAutoCheckpoint for that.
 * If taskId is provided, records under taskCheckpoints; otherwise planCheckpoints.
 * Merges carefully: a completed entry is not overwritten by a skipped one.
 * @param {CheckpointState} state
 * @param {CheckpointRecord} record
 * @param {string} [taskId]
 * @returns {CheckpointState}
 */
export function recordCheckpoint(state, record, taskId) {
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

/**
 * Record a checkpoint with auto provenance. Only callable from the
 * auto-recording hooks that detect real subagent dispatch events.
 * Stamps source:"auto" on the record.
 * @param {CheckpointState} state
 * @param {CheckpointRecord} record
 * @param {string} [taskId]
 * @returns {CheckpointState}
 */
export function recordAutoCheckpoint(state, record, taskId) {
  return recordCheckpoint(state, { ...record, source: "auto" }, taskId);
}

/**
 * Consume the planner checkpoint so the next source edit requires fresh planning.
 * Should be called after a commit succeeds, or in the commit guard before
 * allowing the commit through. If the commit fails, the agent must re-plan.
 * @param {CheckpointState} state
 * @returns {CheckpointState}
 */
export function consumePlannerCheckpoint(state) {
  return {
    ...state,
    planCheckpoints: {},
  };
}

/**
 * Invalidate all verifier checkpoints by setting blocksCommit: true.
 * This should be called whenever source files are edited after a verifier run,
 * forcing re-verification before the next commit.
 * @param {CheckpointState} state
 * @returns {CheckpointState}
 */
export function invalidateVerifierCheckpoints(state) {
  const nextTaskCheckpoints = { ...state.taskCheckpoints };
  for (const [taskId, checkpoints] of Object.entries(nextTaskCheckpoints)) {
    const verifier = checkpoints?.["ged-verifier"];
    if (verifier) {
      nextTaskCheckpoints[taskId] = {
        ...checkpoints,
        "ged-verifier": {
          ...verifier,
          blocksCommit: true,
        },
      };
    }
  }
  return {
    ...state,
    taskCheckpoints: nextTaskCheckpoints,
  };
}

// ─── Git commit detection ───────────────────────────────────────────────

/**
 * Detect whether a bash command contains `git commit`.
 * Handles bypass vectors: prefixed env/rtk/sudo, nested shells, -C flag, chained commands.
 * @param {string} command
 * @returns {boolean}
 */
export function isGitCommitCommand(command) {
  const normalized = command
    .replace(/\\\n/gu, " ")
    .replace(/^(?:rtk\s+)?(?:env\s+(?:-[^\s]*\s+)*\s*)?(?:sudo\s+)?/u, "")
    .trim();

  const gitPattern = /(?:^|[|&;]\s*)git(?:\.(?:exe|cmd))?\b.*\bcommit\b/u;
  return gitPattern.test(normalized);
}

/**
 * Check whether the command contains a skip-checkpoint marker.
 * Only effective when allowCheckpointBypass is true in settings.
 * @param {string} command
 * @returns {boolean}
 */
export function hasSkipCheckpointMarker(command) {
  return /\[skip-checkpoint\]/u.test(command);
}

/**
 * Determine if the work should be auto-escalated to non-trivial based on
 * the number of distinct source file paths being touched.
 * @param {TaskClassification} currentClassification
 * @param {string[]} touchedFilePaths
 * @returns {boolean}
 */
export function shouldAutoEscalate(currentClassification, touchedFilePaths) {
  if (currentClassification === "non-trivial") return false;
  const sourceFiles = touchedFilePaths.filter(
    (p) =>
      !p.includes("/.ged/") &&
      !p.includes("\\.ged\\") &&
      !p.startsWith(".ged/") &&
      !p.startsWith(".ged\\"),
  );
  return sourceFiles.length > 1;
}
