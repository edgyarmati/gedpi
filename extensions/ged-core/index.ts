import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckpointAgent } from "@ged/shared-checkpoints";
import {
  hasSkipCheckpointMarker,
  isGitCommitCommand,
} from "@ged/shared-checkpoints";
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
import { buildOnboardingInterviewKickoff } from "../../src/workflow.js";

export default function gedCoreExtension(api: ExtensionAPI): void {
  registerGedMessageRenderer(api);
  registerPiCommands(api, createGedCommands());
  registerThemeCommand(api);
  registerUpdater(api);
  registerRtkBashRouting(api);
  registerRepoMapTracking(api);

  // ─── Session start ──────────────────────────────────────────────

  api.on("session_start", async (_event, ctx) => {
    await ensurePiSettings(ctx.cwd);
    await syncGedSubagentRuntimeConfig(ctx.cwd);
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

    // --- Auto-recording: detect subagent dispatches and record checkpoints ---
    const subagentName = detectSubagentDispatch(toolName, input);
    if (subagentName) {
      try {
        let state = await readCheckpointState(ctx.cwd);
        if (!state) {
          // Auto-init as non-trivial since we're dispatching subagents
          state = {
            classification: "non-trivial",
            classificationReason: "Subagent dispatched — auto-classified",
            planCheckpoints: {},
            taskCheckpoints: {},
          };
        }
        const now = new Date().toISOString();
        const isTaskAgent =
          subagentName === "ged-explorer" || subagentName === "ged-verifier";
        state = recordCheckpoint(
          state,
          {
            agent: subagentName as CheckpointAgent,
            timestamp: now,
            status: "completed",
          },
          isTaskAgent ? "auto" : undefined,
        );
        await writeCheckpointState(ctx.cwd, state);
      } catch {
        // Non-fatal — don't block the subagent dispatch if recording fails
      }
    }

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

      const state = await readCheckpointState(ctx.cwd);
      // Note: auto-escalation is not implemented in the guard — the agent
      // is expected to classify correctly via the orchestration prompt.
      // The planner guard enforces that classification is honored.

      const validation = validatePlannerCheckpoint(state);
      if (!validation.valid) {
        api.sendMessage({
          customType: "ged-checkpoint-blocked",
          content: plannerGuardMessage(validation),
          display: true,
          details: { title: "planner-guard", missing: validation.missing },
        });
        return { block: true, reason: plannerGuardMessage(validation) };
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
        const validation = validateAllVerifierCheckpoints(state);
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
