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

// ─── Presets ───────────────────────────────────────────────────────────

export type PresetName = "fast" | "balanced" | "strong";

export interface ModelPreset {
  name: PresetName;
  label: string;
  description: string;
  config: {
    defaultModel?: string;
    models: Partial<Record<GedAgentRole, string>>;
  };
}

export const PRESETS: ModelPreset[] = [
  {
    name: "fast",
    label: "Fast / Cheap",
    description: "Lightweight models for speed and low cost.",
    config: {
      defaultModel: "google/gemini-2.5-flash",
      models: {
        "ged-planner": "anthropic/claude-sonnet-4",
        "ged-verifier": "google/gemini-2.5-flash",
      },
    },
  },
  {
    name: "balanced",
    label: "Balanced",
    description: "Smart allocation: strong planner, capable explorer/verifier.",
    config: {
      defaultModel: "anthropic/claude-sonnet-4",
      models: {
        "ged-explorer": "google/gemini-2.5-flash",
        "ged-planner": "anthropic/claude-opus-4",
        "ged-verifier": "openai/gpt-5.5",
      },
    },
  },
  {
    name: "strong",
    label: "Strong / Thorough",
    description: "Maximum capability for all roles. Higher cost and latency.",
    config: {
      defaultModel: "anthropic/claude-opus-4",
      models: {
        "ged-explorer": "anthropic/claude-sonnet-4",
        "ged-planner": "anthropic/claude-opus-4",
        "ged-verifier": "openai/gpt-5.5",
      },
    },
  },
];

const PRESET_BY_NAME = new Map(PRESETS.map((p) => [p.name, p]));

const COMMON_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4",
  "openai/gpt-5.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
];

// ─── Scope helpers ─────────────────────────────────────────────────────

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

// ─── Model set/clear ───────────────────────────────────────────────────

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

// ─── Preset apply ──────────────────────────────────────────────────────

async function applyPreset(
  cwd: string,
  targetPath: string,
  preset: ModelPreset,
): Promise<string> {
  const filePath = resolveTargetPath(cwd, targetPath);
  const existing = await readGedRuntimeSettings(filePath);
  const next: GedAgentsSettings = {
    ...(existing.agents ?? {}),
    defaultModel: preset.config.defaultModel,
    models: { ...preset.config.models },
  };
  await writeGedAgentsSettings(filePath, next);
  await syncGedSubagentRuntimeConfig(cwd);

  const scopeLabel = targetPath === "PROJECT" ? "project" : "global";
  const lines = [
    `Applied **${preset.label}** preset to ${scopeLabel} settings.`,
    "",
    "| Role | Model |",
    "|---|---|",
    `| default | ${preset.config.defaultModel ?? "inherit orchestrator"} |`,
    ...GED_AGENT_ROLES.map((role) => {
      const model = preset.config.models[role] ?? preset.config.defaultModel ?? "inherit orchestrator";
      return `| ${role} | ${model} |`;
    }),
  ];
  return lines.join("\n");
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatModelsList(
  effective: Awaited<ReturnType<typeof readEffectiveGedAgentsSettings>>,
): string {
  const lines: string[] = ["## Current subagent models", ""];

  lines.push("| Role | Effective model | Source |");
  lines.push("|---|---|---|");

  for (const role of GED_AGENT_ROLES) {
    const own = effective.models[role];
    const fallback = effective.defaultModel;
    const label = own
      ? typeof own === "string"
        ? own
        : JSON.stringify(own)
      : fallback
        ? `inherit (${typeof fallback === "string" ? fallback : JSON.stringify(fallback)})`
        : "inherit (orchestrator)";
    const source = own ? "role override" : fallback ? "default" : "orchestrator";
    lines.push(`| ${role} | ${label} | ${source} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("### Quick: apply a preset");
  lines.push("");
  for (const preset of PRESETS) {
    lines.push(`- **${preset.name}** — ${preset.description}`);
    lines.push(`  \`/ged-agents preset ${preset.name}\``);
  }
  lines.push("");
  lines.push("### Quick: set one role");
  lines.push("`/ged-agents model <role> <model-id> [--project]`");
  lines.push("- Roles: `default`, `ged-explorer`, `ged-planner`, `ged-verifier`");
  lines.push("- Use `--project` for project-level (gitignored) override");
  lines.push("- Use `--clear` instead of a model-id to remove an override");
  lines.push("");
  lines.push("### Common model IDs");
  for (const id of COMMON_MODELS) {
    lines.push(`- \`${id}\``);
  }

  return lines.join("\n");
}

function formatSetupWizard(
  effective: Awaited<ReturnType<typeof readEffectiveGedAgentsSettings>>,
): string {
  const lines: string[] = [
    "# Ged Subagent Setup",
    "",
    "Subagents are **read-only intelligence contributors** — the primary Ged brain remains the sole writer.",
    "",
    "## Step 1 — Enable subagents",
    "",
    "```",
    "/ged-agents on              # enable globally",
    "/ged-agents on --project   # enable for this project only",
    "```",
    "",
    "## Step 2 — Pick a preset (easiest)",
    "",
  ];

  for (let i = 0; i < PRESETS.length; i++) {
    const p = PRESETS[i];
    lines.push(`${i + 1}. **${p.label}** — ${p.description}`);
    lines.push(`   \`/ged-agents preset ${p.name}\``);
    lines.push("");
  }

  lines.push("Or set per-role manually:");
  lines.push("```");
  lines.push("/ged-agents model ged-planner anthropic/claude-opus-4");
  lines.push("/ged-agents model ged-explorer google/gemini-2.5-flash --project");
  lines.push("```");
  lines.push("");

  if (effective.enabled) {
    lines.push("✅ Subagents are **enabled**");
  } else {
    lines.push("⚠️ Subagents are **disabled**. Run `/ged-agents on` first.");
  }
  lines.push("");
  lines.push("## Step 3 — Verify");
  lines.push("Run `/ged-agents models` to review current assignments.");
  lines.push("");
  lines.push("---");
  lines.push("**Tip**: Changes take effect immediately — the next subagent dispatch uses the new model.");

  return lines.join("\n");
}

// ─── Main command handler ──────────────────────────────────────────────

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

  if (action === "preset") {
    const { targetPath, remaining } = resolveScope(rest);
    const [presetName] = remaining;
    const preset = presetName ? PRESET_BY_NAME.get(presetName as PresetName) : undefined;

    if (!preset) {
      const names = PRESETS.map((p) => p.name).join(", ");
      return `Usage: /ged-agents preset <${names}> [--project|--global]`;
    }

    return await applyPreset(cwd, targetPath, preset);
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
    return formatSetupWizard(await readEffectiveGedAgentsSettings(cwd));
  }

  return "Usage: /ged-agents [status|models|preset|on|off|model|setup] [--project|--global]";
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
        "Configure optional read-only Ged subagents (status, setup, on, off, preset, model)",
      async execute(context) {
        return await executeGedAgentsCommand(context.cwd, context.args);
      },
    },
  ];
}
