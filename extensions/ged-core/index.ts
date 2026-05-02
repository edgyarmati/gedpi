import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { syncGedSubagentRuntimeConfig } from "../../src/agent-settings.js";
import {
  buildPassiveGedPromptSuffix,
  buildWorkflowPromptSuffix,
  ensureGedReady,
} from "../../src/brain.js";
import { createGedCommands } from "../../src/commands.js";
import { renderHeader } from "../../src/header.js";
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
}
