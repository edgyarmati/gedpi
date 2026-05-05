import {
  formatGedAgentsStatus,
  GED_AGENT_ROLES,
  globalGedSettingsPath,
  projectGedSettingsPath,
  readEffectiveGedAgentsSettings,
  readGedRuntimeSettings,
  syncGedSubagentRuntimeConfig,
  writeGedAgentsSettings,
  type GedAgentRole,
  type GedAgentsSettings,
} from "./agent-settings.js";
import type { AppCommandDefinition } from "./pi.js";
import { executeRtkCommand } from "./rtk.js";

const COMMON_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4",
  "openai/gpt-5.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
];

function resolveScope(args: string[]): { targetPath: string; scopeLabel: string; remaining: string[] } {
  const projectIndex = args.indexOf("--project");
  const globalIndex = args.indexOf("--global");
  if (projectIndex !== -1) {
    const remaining = args.filter((_, i) => i !== projectIndex);
    return { targetPath: "PROJECT", scopeLabel: "project", remaining };
  }
  if (globalIndex !== -1) {
    const remaining = args.filter((_, i) => i !== globalIndex);
    return { targetPath: "GLOBAL", scopeLabel: "global", remaining };
  }
  return { targetPath: "GLOBAL", scopeLabel: "global", remaining: args };
}

function resolveTargetPath(cwd: string, targetPath: string): string {
  return targetPath === "PROJECT" ? projectGedSettingsPath(cwd) : globalGedSettingsPath();
}

async function setAgentModel(
  cwd: string,
  targetPath: string,
  role: "default" | GedAgentRole,
  modelId: string | null,
): Promise<string> {
  const filePath = resolveTargetPath(cwd, targetPath);
  const existing = await readGedRuntimeSettings(filePath);
  const next: GedAgentsSettings = { ...(existing.agents ?? {}) };

  if (role === "default") {
    if (modelId === null) {
      delete next.defaultModel;
    } else {
      next.defaultModel = modelId;
    }
  } else {
    const models = { ...(next.models ?? {}) };
    if (modelId === null) {
      delete models[role];
    } else {
      models[role] = modelId;
    }
    if (Object.keys(models).length === 0) {
      delete next.models;
    } else {
      next.models = models;
    }
  }

  await writeGedAgentsSettings(filePath, next);
  await syncGedSubagentRuntimeConfig(cwd);

  const scopeLabel = targetPath === "PROJECT" ? "project" : "global";
  if (modelId === null) {
    return `Cleared ${role === "default" ? "default model" : role + " model"} from ${scopeLabel} settings.`;
  }
  return `Set ${role === "default" ? "default model" : role + " model"} to \`${modelId}\` in ${scopeLabel} settings.`;
}

function formatModelsList(effective: Awaited<ReturnType<typeof readEffectiveGedAgentsSettings>>): string {
  const lines: string[] = ["## Subagent model assignments", ""];

  for (const role of GED_AGENT_ROLES) {
    const config = effective.models[role];
    const label = config ? (typeof config === "string" ? config : JSON.stringify(config)) : (effective.defaultModel ? `inherit (${typeof effective.defaultModel === "string" ? effective.defaultModel : JSON.stringify(effective.defaultModel)})` : "inherit (orchestrator)");
    const source = config ? "project/global" : effective.defaultModel ? "default" : "orchestrator";
    lines.push(`- **${role}**: ${label} _(source: ${source})_`);
  }

  lines.push("");
  lines.push(`**Default model**: ${effective.defaultModel ? (typeof effective.defaultModel === "string" ? effective.defaultModel : JSON.stringify(effective.defaultModel)) : "none (inherits orchestrator model)"}`);
  lines.push("");
  lines.push("### Set a model");
  lines.push("`/ged-agents model <role> <model-id> [--project]`");
  lines.push("- Role: `default`, `ged-explorer`, `ged-planner`, `ged-verifier`");
  lines.push("- Use `--project` to set project-level override");
  lines.push("- Example: `/ged-agents model ged-planner anthropic/claude-sonnet-4`");
  lines.push("");
  lines.push("### Clear a per-role override");
  lines.push("`/ged-agents model <role> --clear`");
  lines.push("");
  lines.push("### Common model IDs");
  for (const id of COMMON_MODELS) {
    lines.push(`- ${id}`);
  }

  return lines.join("\n");
}

async function executeGedAgentsCommand(
  cwd: string,
  args: string[] = [],
): Promise<string> {
  const [action = "status", ...rest] = args;

  if (action === "status") {
    return formatGedAgentsStatus(await readEffectiveGedAgentsSettings(cwd));
  }

  if (action === "models") {
    return formatModelsList(await readEffectiveGedAgentsSettings(cwd));
  }

  if (action === "on" || action === "off") {
    const { targetPath, scopeLabel, remaining } = resolveScope(rest);
    const filePath = resolveTargetPath(cwd, targetPath);
    const existing = await readGedRuntimeSettings(filePath);
    await writeGedAgentsSettings(filePath, {
      ...(existing.agents ?? {}),
      enabled: action === "on",
    });
    await syncGedSubagentRuntimeConfig(cwd);
    return `Ged optional subagents are now ${action === "on" ? "enabled" : "disabled"} in ${scopeLabel} settings.`;
  }

  if (action === "model") {
    const { targetPath, remaining } = resolveScope(rest);
    const [role, modelId] = remaining;

    if (!role) {
      return "Usage: /ged-agents model <role> <model-id> [--project|--global]\nRoles: default, ged-explorer, ged-planner, ged-verifier\nUse `--clear` instead of a model-id to remove an override.";
    }

    if (role !== "default" && !GED_AGENT_ROLES.includes(role as GedAgentRole)) {
      return `Unknown role: ${role}. Valid roles: default, ${GED_AGENT_ROLES.join(", ")}.`;
    }

    if (modelId === "--clear" || modelId === undefined) {
      return await setAgentModel(cwd, targetPath, role as "default" | GedAgentRole, null);
    }

    return await setAgentModel(cwd, targetPath, role as "default" | GedAgentRole, modelId);
  }

  if (action === "setup") {
    return [
      "Ged optional subagents follow the single-writer invariant: the primary Ged brain writes code, decides scope, adjudicates reviews, commits, pushes, and opens PRs.",
      "Use `/ged-agents on` for global enablement or `/ged-agents on --project` for this project only.",
      "Configure models with `/ged-agents model <role> <model-id>` or view assignments with `/ged-agents models`.",
    ].join("\n");
  }

  return "Usage: /ged-agents [status|models|on|off|model|setup] [--project|--global]";
}

export function createGedCommands(): AppCommandDefinition[] {
  return [
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
