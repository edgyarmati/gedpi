import type { Model, Api } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

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
    const label = config
      ? typeof config === "string"
        ? config
        : `${config.model}${config.fallback && config.fallback.length > 0 ? ` → ${config.fallback.join(" → ")}` : ""}`
      : effective.defaultModel
        ? `inherit (${typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model})`
        : "inherit (orchestrator)";
    const source = config ? "role override" : effective.defaultModel ? "default" : "orchestrator";
    lines.push(`- **${role}**: ${label} _(source: ${source})_`);
  }

  lines.push("");
  lines.push(`**Default model**: ${effective.defaultModel ? (typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model) : "none (inherits orchestrator model)"}`);
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

function formatAvailableModels(registry: ModelRegistry): string {
  const available = registry.getAvailable();
  if (available.length === 0) {
    return "No models with configured API keys found. Set up API keys in Pi settings first.";
  }

  const lines: string[] = [];

  // Group by provider
  const byProvider = new Map<string, Model<Api>[]>();
  for (const model of available) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  for (const [provider, models] of byProvider) {
    lines.push(`### ${registry.getProviderDisplayName(provider) || provider}`);
    lines.push("");
    for (const model of models) {
      const thinkingLevels = model.thinkingLevelMap
        ? Object.entries(model.thinkingLevelMap)
            .filter(([, v]) => v !== null)
            .map(([k]) => k)
            .join(", ")
        : model.reasoning ? "minimal, low, medium, high" : "none";
      lines.push(`- \`${model.provider}/${model.id}\` — ${model.name}`);
      lines.push(`  Context: ${(model.contextWindow / 1000).toFixed(0)}k tokens | Reasoning: ${thinkingLevels}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatSetupWizard(
  effective: Awaited<ReturnType<typeof readEffectiveGedAgentsSettings>>,
  registry: ModelRegistry,
): string {
  const lines: string[] = [
    "# Ged Subagent Setup",
    "",
    "Subagents are **read-only intelligence contributors** — the primary Ged brain remains the sole writer.",
    "",
  ];

  if (!effective.enabled) {
    lines.push("⚠️ Subagents are currently **disabled**.");
    lines.push("");
    lines.push("**Enable them first:**");
    lines.push("```");
    lines.push("/ged-agents on              # globally");
    lines.push("/ged-agents on --project   # this project only");
    lines.push("```");
    lines.push("");
  } else {
    lines.push("✅ Subagents are **enabled**.");
    lines.push("");
  }

  lines.push("## Available models (with API keys)");
  lines.push("");
  lines.push(formatAvailableModels(registry));
  lines.push("");

  lines.push("## Current assignments");
  lines.push("");
  for (const role of GED_AGENT_ROLES) {
    const config = effective.models[role];
    const label = config
      ? typeof config === "string"
        ? config
        : `${config.model}${config.fallback && config.fallback.length > 0 ? ` → ${config.fallback.join(" → ")}` : ""}`
      : effective.defaultModel
        ? `inherit (${typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model})`
        : "inherit (orchestrator)";
    lines.push(`- **${role}**: ${label}`);
  }
  lines.push(`- **default**: ${effective.defaultModel ? (typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model) : "inherit orchestrator"}`);
  lines.push("");

  lines.push("## Quick commands");
  lines.push("");
  lines.push("Set a role model:");
  lines.push("```");
  lines.push("/ged-agents model ged-planner anthropic/claude-opus-4");
  lines.push("/ged-agents model ged-explorer google/gemini-2.5-flash --project");
  lines.push("/ged-agents model default anthropic/claude-sonnet-4");
  lines.push("```");
  lines.push("");
  lines.push("Set with fallback chain (edit JSON directly):");
  lines.push("```json");
  lines.push("// ~/.gedcode/settings.json");
  lines.push('{');
  lines.push('  "agents": {');
  lines.push('    "models": {');
  lines.push('      "ged-planner": {');
  lines.push('        "model": "anthropic/claude-opus-4",');
  lines.push('        "fallback": ["openai/gpt-5.5", "google/gemini-2.5-pro"]');
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push("```");
  lines.push("");
  lines.push("View all assignments: `/ged-agents models`");
  lines.push("Clear an override: `/ged-agents model <role> --clear`");

  return lines.join("\n");
}

async function executeGedAgentsCommand(
  cwd: string,
  args: string[] = [],
  registry?: ModelRegistry,
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
    const effective = await readEffectiveGedAgentsSettings(cwd);
    if (!registry) {
      return [
        "Ged optional subagents follow the single-writer invariant: the primary Ged brain writes code, decides scope, adjudicates reviews, commits, pushes, and opens PRs.",
        "",
        "Use `/ged-agents on` for global enablement or `/ged-agents on --project` for this project only.",
        "Configure models with `/ged-agents model <role> <model-id>` or view assignments with `/ged-agents models`.",
        "",
        "Fallback chains can be set in JSON directly:",
        '{ "agents": { "models": { "ged-planner": { "model": "claude-opus-4", "fallback": ["gpt-5.5"] } } } }',
      ].join("\n");
    }
    return formatSetupWizard(effective, registry);
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
        const registry = context.runtime?.ctx.modelRegistry;
        return await executeGedAgentsCommand(context.cwd, context.args, registry);
      },
    },
  ];
}
