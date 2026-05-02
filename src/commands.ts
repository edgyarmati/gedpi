import {
  formatGedAgentsStatus,
  globalGedSettingsPath,
  projectGedSettingsPath,
  readEffectiveGedAgentsSettings,
  readGedRuntimeSettings,
  syncGedSubagentRuntimeConfig,
  writeGedAgentsSettings,
} from "./agent-settings.js";
import type { AppCommandDefinition } from "./pi.js";
import { executeRtkCommand } from "./rtk.js";
import { formatGedModeStatus, readGedMode, saveGedMode } from "./theme.js";

async function executeGedAgentsCommand(
  cwd: string,
  args: string[] = [],
): Promise<string> {
  const [action = "status", scopeFlag] = args;
  const projectScope = scopeFlag === "--project";
  const targetPath = projectScope
    ? projectGedSettingsPath(cwd)
    : globalGedSettingsPath();

  if (action === "status") {
    return formatGedAgentsStatus(await readEffectiveGedAgentsSettings(cwd));
  }
  if (action === "on" || action === "off") {
    const existing = await readGedRuntimeSettings(targetPath);
    await writeGedAgentsSettings(targetPath, {
      ...(existing.agents ?? {}),
      enabled: action === "on",
    });
    await syncGedSubagentRuntimeConfig(cwd);
    const scope = projectScope ? "project" : "global";
    return `Ged optional subagents are now ${action === "on" ? "enabled" : "disabled"} in ${scope} settings. Restart or reload Pi for extension-level settings changes to take effect.`;
  }
  if (action === "setup") {
    return [
      "Ged optional subagents follow the single-writer invariant: the primary Ged brain writes code, decides scope, adjudicates reviews, commits, pushes, and opens PRs.",
      "Use `/ged-agents on` for global enablement or `/ged-agents on --project` for this project only.",
      "Configure models in ~/.gedcode/settings.json or .gedcode/settings.json under agents.defaultModel and agents.models for ged-explorer, ged-planner, and ged-verifier.",
    ].join("\n");
  }
  return "Usage: /ged-agents [status|on|off|setup] [--project]";
}

export function createGedCommands(): AppCommandDefinition[] {
  return [
    {
      name: "ged-mode",
      description: "Toggle Ged mode on or off for this project",
      async execute(context) {
        const enabled = !readGedMode(context.cwd);
        saveGedMode(context.cwd, enabled);
        context.runtime?.ctx.ui.setStatus(
          "gedpi",
          formatGedModeStatus(enabled),
        );
        if (!enabled) {
          context.runtime?.ctx.ui.setWidget("ged-dashboard", undefined);
          context.runtime?.ctx.ui.setWidget("ged-todos", undefined);
        }
        return enabled
          ? "Ged mode is now ON. The next agent turn will initialize or refresh .ged/ and use the full Ged workflow."
          : "Ged mode is now OFF. Ged will keep using durable standards from .ged/ when present, but task workflow state is disabled.";
      },
    },
    {
      name: "ged-rtk",
      description:
        "Install RTK and control Ged's bash-side RTK routing (status, install, on, off)",
      async execute(context) {
        if (!context.runtime) {
          return "The /ged-rtk command is only available inside GedPi interactive sessions.";
        }
        return await executeRtkCommand(context.args, context.runtime.ctx);
      },
    },
    {
      name: "ged-agents",
      description:
        "Configure optional read-only Ged subagents (status, setup, on, off)",
      async execute(context) {
        return await executeGedAgentsCommand(context.cwd, context.args);
      },
    },
  ];
}
