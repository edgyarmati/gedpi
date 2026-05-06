/**
 * Shared checkpoint state types and validation for GedCode and GedPi.
 *
 * Both packages use the same .ged/runtime/<work-id>/checkpoints.json schema
 * to ensure the .ged/ memory format stays interchangeable.
 *
 * Vendored from @ged/shared-checkpoints to ensure it ships with the npm package.
 */

// ─── Initializers ───────────────────────────────────────────────────────

/**
 * @param {"trivial" | "non-trivial"} classification
 * @param {string} classificationReason
 * @returns {import("./shared-checkpoints.d.ts").CheckpointState}
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
 * @returns {value is import("./shared-checkpoints.d.ts").CheckpointState}
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
 * @returns {import("./shared-checkpoints.d.ts").CheckpointState | null}
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
 * @param {import("./shared-checkpoints.d.ts").CheckpointState | null} state
 * @returns {import("./shared-checkpoints.d.ts").CheckpointValidation}
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
 * @param {import("./shared-checkpoints.d.ts").CheckpointState | null} state
 * @param {string} taskId
 * @returns {import("./shared-checkpoints.d.ts").CheckpointValidation}
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
 * @param {import("./shared-checkpoints.d.ts").CheckpointState | null} state
 * @returns {import("./shared-checkpoints.d.ts").CheckpointValidation}
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
 * @param {import("./shared-checkpoints.d.ts").CheckpointState | null} state
 * @returns {import("./shared-checkpoints.d.ts").CheckpointValidation}
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
 * @param {import("./shared-checkpoints.d.ts").CheckpointState} state
 * @param {import("./shared-checkpoints.d.ts").CheckpointRecord} record
 * @param {string} [taskId]
 * @returns {import("./shared-checkpoints.d.ts").CheckpointState}
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

// ─── Auto-escalation ────────────────────────────────────────────────────

/**
 * Invalidate all verifier checkpoints by setting blocksCommit: true.
 * This should be called whenever source files are edited after a verifier run,
 * forcing re-verification before the next commit.
 * @param {import("./shared-checkpoints.d.ts").CheckpointState} state
 * @returns {import("./shared-checkpoints.d.ts").CheckpointState}
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
 * @param {import("./shared-checkpoints.d.ts").TaskClassification} currentClassification
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
