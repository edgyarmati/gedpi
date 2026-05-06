import type { Api, Model } from "@mariozechner/pi-ai";
// Pi UI context type alias for the command handler
import type {
  ExtensionUIContext,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import {
  formatGedAgentsStatus,
  GED_AGENT_ROLES,
  type GedAgentRole,
  type GedAgentsSettings,
  globalGedSettingsPath,
  type ModelAvailability,
  projectGedSettingsPath,
  readEffectiveGedAgentsSettings,
  readGedRuntimeSettings,
  syncGedSubagentRuntimeConfig,
  writeGedAgentsSettings,
} from "./agent-settings.js";
import { pickModel } from "./fuzzy-picker.js";
import type { AppCommandContext, AppCommandDefinition } from "./pi.js";
import { executeRtkCommand } from "./rtk.js";

// ─── Curated defaults for non-UI fallback ──────────────────────────────

const DEFAULT_EXPLORER = "deepseek/deepseek-v4-flash";
const DEFAULT_PLANNER = "openai/gpt-5.5";
const DEFAULT_VERIFIER = "anthropic/claude-opus-4.7";

// ─── Scope helpers ─────────────────────────────────────────────────────

function resolveScope(args: string[]): {
  targetPath: string;
  scopeLabel: string;
  remaining: string[];
} {
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
  return targetPath === "PROJECT"
    ? projectGedSettingsPath(cwd)
    : globalGedSettingsPath();
}

// ─── Model helpers ─────────────────────────────────────────────────────

function formatModelRef(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function splitModelRef(
  ref: string,
): { provider: string; id: string } | undefined {
  const slashIndex = ref.indexOf("/");
  if (slashIndex <= 0 || slashIndex === ref.length - 1) return undefined;
  return {
    provider: ref.slice(0, slashIndex),
    id: ref.slice(slashIndex + 1),
  };
}

function modelAvailabilityFromRegistry(
  registry: ModelRegistry | undefined,
): ModelAvailability | undefined {
  if (!registry) return undefined;
  return {
    isAvailable(modelId) {
      const parsed = splitModelRef(modelId);
      if (!parsed) return false;
      return Boolean(registry.find(parsed.provider, parsed.id));
    },
  };
}

// ─── Settings I/O ──────────────────────────────────────────────────────

async function setAgentModel(
  cwd: string,
  targetPath: string,
  role: "default" | GedAgentRole,
  modelId: string | null,
  availability?: ModelAvailability,
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
  await syncGedSubagentRuntimeConfig(cwd, { modelAvailability: availability });

  const scopeLabel = targetPath === "PROJECT" ? "project" : "global";
  if (modelId === null) {
    return `Cleared ${role === "default" ? "default model" : role + " model"} from ${scopeLabel} settings.`;
  }
  return `Set ${role === "default" ? "default model" : role + " model"} to \`${modelId}\` in ${scopeLabel} settings.`;
}

async function applyAgentConfig(
  cwd: string,
  targetPath: string,
  config: {
    explorer?: string;
    planner?: string;
    verifier?: string;
  },
  availability?: ModelAvailability,
): Promise<string> {
  const filePath = resolveTargetPath(cwd, targetPath);
  const existing = await readGedRuntimeSettings(filePath);
  const next: GedAgentsSettings = { ...(existing.agents ?? {}), enabled: true };

  const models: Partial<
    Record<GedAgentRole, string | { model: string; fallback: string[] }>
  > = {};

  function buildConfig(
    primary: string | undefined,
  ): string | { model: string; fallback: string[] } | undefined {
    if (!primary) return undefined;
    const provider = primary.split("/")[0];
    if (provider === "openai") {
      return {
        model: primary,
        fallback: ["anthropic/claude-opus-4.7", "deepseek/deepseek-v4-pro"],
      };
    }
    if (provider === "anthropic") {
      return {
        model: primary,
        fallback: ["openai/gpt-5.5", "deepseek/deepseek-v4-pro"],
      };
    }
    if (provider === "deepseek") {
      return {
        model: primary,
        fallback: ["openai/gpt-5.5", "anthropic/claude-opus-4.7"],
      };
    }
    return {
      model: primary,
      fallback: ["openai/gpt-5.5", "anthropic/claude-opus-4.7"],
    };
  }

  if (config.explorer) {
    const cfg = buildConfig(config.explorer);
    if (cfg) models["ged-explorer"] = cfg;
  }
  if (config.planner) {
    const cfg = buildConfig(config.planner);
    if (cfg) models["ged-planner"] = cfg;
  }
  if (config.verifier) {
    const cfg = buildConfig(config.verifier);
    if (cfg) models["ged-verifier"] = cfg;
  }

  if (Object.keys(models).length > 0) {
    next.models = models as Record<
      GedAgentRole,
      string | { model: string; fallback?: string[] }
    >;
  }

  await writeGedAgentsSettings(filePath, next);
  await syncGedSubagentRuntimeConfig(cwd, { modelAvailability: availability });

  const scopeLabel = targetPath === "PROJECT" ? "project" : "global";
  const lines = [
    `Ged subagents enabled for this ${scopeLabel}.`,
    "",
    config.explorer ? `- Explorer: ${config.explorer}` : "",
    config.planner ? `- Planner: ${config.planner}` : "",
    config.verifier ? `- Verifier: ${config.verifier}` : "",
    "- Fallback chains: enabled",
    "",
    "Run `/ged-agents status` to review.",
  ].filter(Boolean);

  return lines.join("\n");
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatModelsList(
  effective: Awaited<ReturnType<typeof readEffectiveGedAgentsSettings>>,
): string {
  const lines: string[] = ["## Current subagent models", ""];

  for (const role of GED_AGENT_ROLES) {
    const config = effective.models[role];
    const label = config
      ? typeof config === "string"
        ? config
        : `${config.model}${config.fallback && config.fallback.length > 0 ? ` → ${config.fallback.join(" → ")}` : ""}`
      : effective.defaultModel
        ? `inherit (${typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model})`
        : "inherit (orchestrator)";
    const source = config
      ? "role override"
      : effective.defaultModel
        ? "default"
        : "orchestrator";
    lines.push(`- **${role}**: ${label} _(source: ${source})_`);
  }

  lines.push(
    `- **default**: ${effective.defaultModel ? (typeof effective.defaultModel === "string" ? effective.defaultModel : effective.defaultModel.model) : "inherit orchestrator"}`,
  );
  lines.push("");
  lines.push("Change: `/ged-agents model <role> <model-id> [--project]`");
  lines.push("Clear: `/ged-agents model <role> --clear`");

  return lines.join("\n");
}

function formatCompactSetup(): string {
  return [
    "## Quick setup (copy & run)",
    "",
    "```",
    "/ged-agents on --project",
    `/ged-agents model ged-explorer ${DEFAULT_EXPLORER} --project`,
    `/ged-agents model ged-planner ${DEFAULT_PLANNER} --project`,
    `/ged-agents model ged-verifier ${DEFAULT_VERIFIER} --project`,
    "```",
    "",
    "Or run `/ged-agents setup` in an interactive Pi session for a searchable model picker.",
  ].join("\n");
}

// ─── Interactive wizard ────────────────────────────────────────────────
async function runInteractiveSetup(ctx: AppCommandContext): Promise<string> {
  const ui = ctx.runtime?.ctx.ui;
  const registry = ctx.runtime?.ctx.modelRegistry;
  if (!ui || !registry) {
    return formatCompactSetup();
  }

  const effective = await readEffectiveGedAgentsSettings(ctx.cwd);

  // Step 1: Scope
  const scopeChoice = await ui.select("Set up Ged subagents", [
    "This project only",
    "Globally",
    "Cancel",
  ]);
  if (!scopeChoice || scopeChoice === "Cancel") {
    return "Setup cancelled.";
  }
  const targetPath = scopeChoice === "This project only" ? "PROJECT" : "GLOBAL";
  const scopeLabel = targetPath === "PROJECT" ? "project" : "global";

  // Step 2–4: Live fuzzy-search model pickers
  const explorerModel = await pickModel(ui, registry, "Explorer model");
  if (explorerModel === null) return "Setup cancelled.";

  const plannerModel = await pickModel(ui, registry, "Planner model");
  if (plannerModel === null) return "Setup cancelled.";

  const verifierModel = await pickModel(ui, registry, "Verifier model");
  if (verifierModel === null) return "Setup cancelled.";

  // Step 5: Confirmation
  const summary = [
    `Scope: ${scopeLabel}`,
    "",
    `Explorer: ${formatModelRef(explorerModel)}`,
    `Planner: ${formatModelRef(plannerModel)}`,
    `Verifier: ${formatModelRef(verifierModel)}`,
    "",
    "Fallback chains will be enabled automatically.",
  ].join("\n");

  const confirmed = await ui.confirm("Apply Ged subagent setup?", summary);
  if (!confirmed) {
    return "Setup cancelled.";
  }

  // Step 6: Apply
  const result = await applyAgentConfig(
    ctx.cwd,
    targetPath,
    {
      explorer: formatModelRef(explorerModel),
      planner: formatModelRef(plannerModel),
      verifier: formatModelRef(verifierModel),
    },
    modelAvailabilityFromRegistry(registry),
  );

  ui.notify("Ged subagents configured", "info");

  return result;
}

// ─── Main command handler ──────────────────────────────────────────────

async function executeGedAgentsCommand(
  cwd: string,
  args: string[] = [],
  ctx?: AppCommandContext,
): Promise<string> {
  const [action = "status", ...rest] = args;

  if (action === "status") {
    return formatGedAgentsStatus(await readEffectiveGedAgentsSettings(cwd));
  }

  if (action === "models") {
    return formatModelsList(await readEffectiveGedAgentsSettings(cwd));
  }

  if (action === "setup") {
    if (ctx?.runtime?.ctx.hasUI) {
      return await runInteractiveSetup(ctx);
    }
    return formatCompactSetup();
  }

  if (action === "on" || action === "off") {
    const { targetPath, scopeLabel } = resolveScope(rest);
    const filePath = resolveTargetPath(cwd, targetPath);
    const existing = await readGedRuntimeSettings(filePath);
    await writeGedAgentsSettings(filePath, {
      ...(existing.agents ?? {}),
      enabled: action === "on",
    });
    await syncGedSubagentRuntimeConfig(cwd, {
      modelAvailability: modelAvailabilityFromRegistry(
        ctx?.runtime?.ctx.modelRegistry,
      ),
    });
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
      return await setAgentModel(
        cwd,
        targetPath,
        role as "default" | GedAgentRole,
        null,
        modelAvailabilityFromRegistry(ctx?.runtime?.ctx.modelRegistry),
      );
    }

    return await setAgentModel(
      cwd,
      targetPath,
      role as "default" | GedAgentRole,
      modelId,
      modelAvailabilityFromRegistry(ctx?.runtime?.ctx.modelRegistry),
    );
  }

  return "Usage: /ged-agents [status|models|setup|on|off|model] [--project|--global]";
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
        return await executeGedAgentsCommand(
          context.cwd,
          context.args,
          context,
        );
      },
    },
  ];
}
