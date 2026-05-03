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
  readCheckpointState,
  validateCommitCheckpoints,
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
  formatGedModeStatus,
  loadSavedTheme,
  readGedMode,
  readRtkMode,
} from "../../src/theme.js";
import { registerThemeCommand } from "../../src/theme-command.js";
import { registerTodoShortcut } from "../../src/todo-shortcut.js";
import { registerUpdater } from "../../src/updater.js";
import { buildOnboardingInterviewKickoff } from "../../src/workflow.js";

export default function gedCoreExtension(api: ExtensionAPI): void {
  registerGedMessageRenderer(api);
  registerPiCommands(api, createGedCommands());
  registerThemeCommand(api);
  registerTodoShortcut(api);
  registerUpdater(api);
  registerRtkBashRouting(api);
  registerRepoMapTracking(api);

  api.on("session_start", async (_event, ctx) => {
    await ensurePiSettings(ctx.cwd);
    await syncGedSubagentRuntimeConfig(ctx.cwd);
    ensureBundledPromptTemplates(
      fileURLToPath(
        new URL("../../templates/managed-prompts", import.meta.url),
      ),
    );
    loadSavedTheme(ctx.cwd);
    const gedMode = readGedMode(ctx.cwd);
    ctx.ui.setTitle("GedPi");
    ctx.ui.setTheme(createGedTheme());
    ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
    ctx.ui.setStatus("gedpi", formatGedModeStatus(gedMode));
    ctx.ui.setStatus("rtk", formatRtkModeStatus(readRtkMode(ctx.cwd), false));
    await refreshRtkStatusIndicator(ctx);
    void warmRepoMap(ctx.cwd);
  });

  api.on("before_agent_start", async (event, ctx) => {
    const gedMode = readGedMode(ctx.cwd);
    const passivePrompt = await buildPassiveGedPromptSuffix(ctx.cwd);
    const repoMapPrompt = await buildRepoMapPromptSuffix(ctx.cwd, {
      prompt: typeof event.prompt === "string" ? event.prompt : "",
      maxTokens: gedMode ? undefined : 120,
    });
    if (!gedMode) {
      return {
        systemPrompt: [event.systemPrompt, passivePrompt, repoMapPrompt]
          .filter(Boolean)
          .join("\n\n"),
      };
    }

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
        details: { title: "ged-mode" },
      });
    }

    return {
      systemPrompt: prompt,
    };
  });

  api.on("turn_end", async (_event, ctx) => {
    const gedMode = readGedMode(ctx.cwd);
    if (!gedMode) return;

    const agentSettings = await readEffectiveGedAgentsSettings(ctx.cwd).catch(
      () => null,
    );
    if (!agentSettings?.enabled) return;

    const recentCommits = await detectRecentCommits(ctx.cwd, 120);
    if (recentCommits.length === 0) return;

    const checkpointState = await readCheckpointState(ctx.cwd);
    if (!checkpointState || checkpointState.classification === "trivial")
      return;

    const taskIds = Object.keys(checkpointState.taskCheckpoints);
    const tasksToValidate = taskIds.length > 0 ? taskIds : ["unknown"];

    const allMissing: string[] = [];
    for (const taskId of tasksToValidate) {
      const validation = validateCommitCheckpoints(checkpointState, taskId);
      if (!validation.valid) {
        allMissing.push(
          ...validation.missing.map((m) => `${m} (task ${taskId})`),
        );
      }
    }

    if (allMissing.length > 0) {
      api.sendMessage({
        customType: "ged-checkpoint-warning",
        content: `Checkpoint warning: You committed without completing required checkpoints: ${allMissing.join(", ")}. For non-trivial work, dispatch ged-verifier for clean-context review before committing. If intentionally skipped, record a skip reason in .ged/runtime/checkpoints.json.`,
        display: true,
        details: {
          title: "checkpoint-gate",
          missing: allMissing,
        },
      });
    }
  });
}
