/**
 * Shared checkpoint state types and validation for GedCode and GedPi.
 *
 * Both packages use the same .ged/runtime/<work-id>/checkpoints.json schema
 * to ensure the .ged/ memory format stays interchangeable.
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
 * @typedef {Object} CheckpointRecord
 * @property {CheckpointAgent} agent
 * @property {string} timestamp
 * @property {"completed" | "skipped"} status
 * @property {string} [skipReason]
 * @property {number} [findingCount]
 * @property {boolean} [blocksCommit]
 */

/**
 * @typedef {Object} CheckpointState
 * @property {TaskClassification} classification
 * @property {string} classificationReason
 * @property {Record<PlanCheckpointAgent, CheckpointRecord>} planCheckpoints
 * @property {Record<string, Record<TaskCheckpointAgent, CheckpointRecord>>} taskCheckpoints
 */

/**
 * @typedef {Object} CheckpointValidation
 * @property {boolean} valid
 * @property {string[]} missing
 * @property {string} [warning]
 */

// ─── Initializers ───────────────────────────────────────────────────────

/**
 * @param {TaskClassification} classification
 * @param {string} classificationReason
 * @returns {CheckpointState}
 */
export function initCheckpointState(classification, classificationReason) {
  return {
    classification,
    classificationReason,
    planCheckpoints: {},
    taskCheckpoints: {},
  };
}

// ─── Validation ─────────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {value is CheckpointState}
 */
function isValidCheckpointState(value) {
  if (typeof value !== "object" || value === null) return false;
  const obj = /** @type {Record<string, unknown>} */ (value);
  return (
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
 * Returns valid=false for null state (classification is required before edits).
 * Returns valid=true for trivial classification (no planner needed).
 * @param {CheckpointState | null} state
 * @returns {CheckpointValidation}
 */
export function validatePlannerCheckpoint(state) {
  if (!state) {
    return {
      valid: false,
      missing: ["classification"],
      warning:
        "No checkpoint state found — classify the task and write .ged/runtime/<work-id>/checkpoints.json before editing source files.",
    };
  }
  if (state.classification === "trivial") {
    return { valid: true, missing: [] };
  }
  const missing = [];
  if (!state.planCheckpoints["ged-planner"]) {
    missing.push("ged-planner");
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
  if (!state.taskCheckpoints[taskId]?.["ged-verifier"]) {
    missing.push("ged-verifier");
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Check verifier checkpoints for ALL task slices that have any checkpoint data.
 * Returns valid=false for null state (classification is required before commits).
 * Returns invalid if any in-progress slice lacks a verifier checkpoint.
 * This prevents the agent from committing with partially-verified changes.
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
    if (verifier.blocksCommit) {
      missing.push(`ged-verifier blocked commit (task ${taskId})`);
    }
  }
  if (!sawVerifier) {
    missing.push("ged-verifier");
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Validate whether it is safe to create or amend a git commit.
 * Commit readiness is stricter than source-edit readiness: non-trivial work
 * requires classification, planner review, and at least one verifier review.
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
  if (!state.planCheckpoints["ged-planner"]) {
    missing.push("ged-planner");
  }

  const verifierValidation = validateAllVerifierCheckpoints(state);
  missing.push(...verifierValidation.missing);

  return { valid: missing.length === 0, missing };
}

// ─── Mutation ───────────────────────────────────────────────────────────

/**
 * Record a checkpoint in the state. Returns a new state object.
 * If taskId is provided, records under taskCheckpoints; otherwise planCheckpoints.
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

// ─── Git commit detection ───────────────────────────────────────────────

/**
 * Detect whether a bash command contains `git commit`.
 * Handles bypass vectors: prefixed env/rtk/sudo, nested shells, -C flag, chained commands.
 * @param {string} command
 * @returns {boolean}
 */
export function isGitCommitCommand(command) {
  // Normalize: strip common prefixes (env, sudo, rtk), collapse line continuations
  const normalized = command
    .replace(/\\\n/gu, " ")
    .replace(/^(?:rtk\s+)?(?:env\s+(?:-[^\s]*\s+)*\s*)?(?:sudo\s+)?/u, "")
    .trim();

  // Anchored: git must appear as a command word (after start, pipe, &&, ||, ;)
  // This avoids false positives from `echo "git commit"` or `grep git commit`
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

// ─── Consumption & invalidation ────────────────────────────────────────

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
