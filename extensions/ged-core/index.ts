import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  readEffectiveGedAgentsSettings,
  syncGedSubagentRuntimeConfig,
} from "../../src/agent-settings.js";
import {
  buildPassiveGedPromptSuffix,
  buildWorkflowPromptSuffix,
  ensureGedReady,
} from "../../src/brain.js";
import { createGedCommands } from "../../src/commands.js";
import { renderHeader } from "../../src/header.js";
import {
  detectRecentCommits,
  detectSubagentDispatch,
  plannerGuardMessage,
  readCheckpointState,
  recordCheckpoint,
  validateAllVerifierCheckpoints,
  validateCommitCheckpoints,
  validatePlannerCheckpoint,
  verifierGuardMessage,
  writeCheckpointState,
} from "../../src/orchestration.js";
import {
  registerGedMessageRenderer,
  registerPiCommands,
} from "../../src/pi.js";
import { ensureBundledPromptTemplates } from "../../src/prompt-template-sync.js";
import {
  buildRepoMapPromptSuffix,
  registerRepoMapTracking,
  warmRepoMap,
} from "../../src/repo-map-runtime.js";
import {
  formatRtkModeStatus,
  refreshRtkStatusIndicator,
  registerRtkBashRouting,
} from "../../src/rtk.js";
import {
  createGedTheme,
  ensurePiSettings,
  formatGedStatus,
  loadSavedTheme,
  readRtkMode,
} from "../../src/theme.js";
import { registerThemeCommand } from "../../src/theme-command.js";
import { registerUpdater } from "../../src/updater.js";
import type { CheckpointAgent } from "../../src/vendor/shared-checkpoints.js";
import {
  hasSkipCheckpointMarker,
  invalidateVerifierCheckpoints,
  isGitCommitCommand,
  shouldAutoEscalate,
} from "../../src/vendor/shared-checkpoints.js";
import { buildOnboardingInterviewKickoff } from "../../src/workflow.js";

// ─── Session-level touched-files tracking ──────────────────────────
const touchedSourceFiles = new Set<string>();
let activeCwd: string | undefined;

async function recordGedSubagentCheckpoint(
  cwd: string,
  subagentName: string,
): Promise<void> {
  let state = await readCheckpointState(cwd);
  if (!state) {
    state = {
      classification: "non-trivial",
      classificationReason: "Subagent dispatched — auto-classified",
      planCheckpoints: {},
      taskCheckpoints: {},
    };
  }
  const isTaskAgent =
    subagentName === "ged-explorer" || subagentName === "ged-verifier";
  const next = recordCheckpoint(
    state,
    {
      agent: subagentName as CheckpointAgent,
      timestamp: new Date().toISOString(),
      status: "completed",
      blocksCommit: subagentName === "ged-verifier" ? true : undefined,
    },
    isTaskAgent ? "auto" : undefined,
  );
  await writeCheckpointState(cwd, next);
}

export default async function gedCoreExtension(
  api: ExtensionAPI,
): Promise<void> {
  // ── Optional pi-claude-cli provider ───────────────────────────
  // Detects at runtime: if the user has installed pi-claude-cli
  // alongside GedPi, register its Claude Code CLI provider so models
  // appear in /ged-agents setup and can be assigned to subagent roles.
  // Uses createRequire to resolve from ged-core's location so global
  // installs of pi-claude-cli (alongside global GedPi) are found.
  try {
    const resolvePath = createRequire(import.meta.url).resolve(
      "pi-claude-cli",
    );
    const piClaudeCli = await import(resolvePath);
    if (typeof piClaudeCli.default === "function") {
      await piClaudeCli.default(api);
    }
  } catch {
    // pi-claude-cli not installed — no Claude Code CLI models available
  }

  // Reset touched files on session start
  api.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    touchedSourceFiles.clear();
  });

  api.events?.on("subagents:completed", (raw: unknown) => {
    const event = raw as { type?: unknown };
    if (typeof event.type !== "string" || !activeCwd) return;
    const subagentName = detectSubagentDispatch("Agent", {
      subagent_type: event.type,
    });
    if (!subagentName) return;
    void recordGedSubagentCheckpoint(activeCwd, subagentName).catch(() => {
      // Non-fatal — lifecycle events should not break the subagent runtime.
    });
  });

  registerGedMessageRenderer(api);
  registerPiCommands(api, createGedCommands());
  registerThemeCommand(api);
  registerUpdater(api);
  registerRtkBashRouting(api);
  registerRepoMapTracking(api);

  // ─── Session start ──────────────────────────────────────────────

  api.on("session_start", async (_event, ctx) => {
    await ensurePiSettings(ctx.cwd);
    await syncGedSubagentRuntimeConfig(
      ctx.cwd,
      ctx.modelRegistry
        ? {
            modelAvailability: {
              isAvailable(modelId) {
                const slashIndex = modelId.indexOf("/");
                if (slashIndex <= 0 || slashIndex === modelId.length - 1) {
                  return false;
                }
                const provider = modelId.slice(0, slashIndex);
                const id = modelId.slice(slashIndex + 1);
                return Boolean(ctx.modelRegistry.find(provider, id));
              },
            },
          }
        : undefined,
    );
    ensureBundledPromptTemplates(
      fileURLToPath(
        new URL("../../templates/managed-prompts", import.meta.url),
      ),
    );
    loadSavedTheme(ctx.cwd);
    ctx.ui.setTitle("GedPi");
    ctx.ui.setTheme(createGedTheme());
    ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
    ctx.ui.setStatus("gedpi", formatGedStatus());
    ctx.ui.setStatus("rtk", formatRtkModeStatus(readRtkMode(ctx.cwd), false));
    await refreshRtkStatusIndicator(ctx);
    void warmRepoMap(ctx.cwd);
  });

  // ─── Before agent start (system prompt injection) ───────────────

  api.on("before_agent_start", async (event, ctx) => {
    const passivePrompt = await buildPassiveGedPromptSuffix(ctx.cwd);
    const repoMapPrompt = await buildRepoMapPromptSuffix(ctx.cwd, {
      prompt: typeof event.prompt === "string" ? event.prompt : "",
    });

    const init = await ensureGedReady(ctx.cwd, {
      ui: "ui" in ctx ? ctx.ui : undefined,
    });
    const workflowPrompt = await buildWorkflowPromptSuffix(ctx.cwd);
    const onboardingKickoff = init.initResult?.onboardingInterviewNeeded
      ? buildOnboardingInterviewKickoff(init.initResult)
      : "";
    const prompt = [
      event.systemPrompt,
      passivePrompt,
      workflowPrompt,
      repoMapPrompt,
      onboardingKickoff,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (init.initResult?.standardsPromptNeeded) {
      api.sendMessage({
        customType: "ged-update",
        content:
          "Ged found external instruction files that can be imported into .ged/STANDARDS.md. Please confirm in chat whether Ged should keep those standards.",
        display: true,
        details: { title: "ged-init" },
      });
    }

    return {
      systemPrompt: prompt,
    };
  });

  // ─── Tool call interception (hard guards) ───────────────────────

  api.on("tool_call", async (event, ctx) => {
    const input = event.input as Record<string, unknown>;
    const toolName: string = (input.toolName as string) ?? "";

    // --- Planner guard: block write/edit to non-.ged source files ---
    if (toolName === "write" || toolName === "edit") {
      const filePath = String(
        (input as Record<string, unknown>).filePath ??
          (input as Record<string, unknown>).path ??
          "",
      );
      // Allow .ged/ writes unconditionally
      if (
        filePath.includes(`${path.sep}.ged${path.sep}`) ||
        filePath.includes("/.ged/") ||
        filePath.includes("\\.ged\\")
      ) {
        return;
      }

      let state = await readCheckpointState(ctx.cwd);

      // Auto-escalation: if classified as trivial but touching >1 source file,
      // reclassify to non-trivial and persist. This triggers the planner guard
      // on subsequent writes until ged-planner is dispatched.
      if (state?.classification === "trivial") {
        touchedSourceFiles.add(filePath);
        if (shouldAutoEscalate(state.classification, [...touchedSourceFiles])) {
          state = {
            ...state,
            classification: "non-trivial",
            classificationReason:
              "Auto-escalated: >1 source file touched in this session",
          };
          await writeCheckpointState(ctx.cwd, state);
        }
      }

      const validation = validatePlannerCheckpoint(state);
      if (!validation.valid) {
        const message = plannerGuardMessage(validation);
        api.sendMessage({
          customType: "ged-checkpoint-blocked",
          content: message,
          display: true,
          details: { title: "planner-guard", missing: validation.missing },
        });
        return { block: true, reason: message };
      }

      // Invalidate verifier checkpoints: any source edit makes prior
      // verifier reviews stale. Forces re-verification before commit.
      if (state) {
        const invalidated = invalidateVerifierCheckpoints(state);
        if (invalidated !== state) {
          await writeCheckpointState(ctx.cwd, invalidated);
        }
      }
    }

    // --- Verifier guard: block git commit ---
    if (toolName === "bash") {
      const command = input.command;
      if (typeof command === "string" && isGitCommitCommand(command)) {
        // Check for bypass marker — only effective if settings allow it
        if (hasSkipCheckpointMarker(command)) {
          const settings = await readEffectiveGedAgentsSettings(ctx.cwd).catch(
            () => null,
          );
          if (settings?.allowCheckpointBypass) {
            return; // Allow through
          }
        }

        const state = await readCheckpointState(ctx.cwd);
        const validation = validateCommitCheckpoints(state);
        if (!validation.valid) {
          api.sendMessage({
            customType: "ged-checkpoint-blocked",
            content: verifierGuardMessage(validation),
            display: true,
            details: { title: "verifier-guard", missing: validation.missing },
          });
          return { block: true, reason: verifierGuardMessage(validation) };
        }
      }
    }
  });

  // ─── Turn end (post-hoc checkpoint warning) ─────────────────────

  api.on("turn_end", async (_event, ctx) => {
    const agentSettings = await readEffectiveGedAgentsSettings(ctx.cwd).catch(
      () => null,
    );
    if (!agentSettings?.enabled) return;

    const recentCommits = await detectRecentCommits(ctx.cwd, 120);
    if (recentCommits.length === 0) return;

    const checkpointState = await readCheckpointState(ctx.cwd);
    if (!checkpointState || checkpointState.classification === "trivial")
      return;

    const validation = validateAllVerifierCheckpoints(checkpointState);
    if (!validation.valid) {
      api.sendMessage({
        customType: "ged-checkpoint-warning",
        content: `Checkpoint warning: You committed without completing required checkpoints: ${validation.missing.join(", ")}. For non-trivial work, dispatch ged-verifier for clean-context review before committing. If intentionally skipped, record a skip reason in .ged/runtime/checkpoints.json.`,
        display: true,
        details: {
          title: "checkpoint-gate",
          missing: validation.missing,
        },
      });
    }
  });
}
