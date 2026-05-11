import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import { ensureIgnoredInGitignore } from "./standards.js";

export const GED_AGENT_ROLES = [
  "ged-explorer",
  "ged-planner",
  "ged-verifier",
] as const;

export type GedAgentRole = (typeof GED_AGENT_ROLES)[number];

const ALLOWED_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type AgentModelConfig =
  | string
  | ({ model: string; fallback?: string[] } & Record<string, unknown>);

export interface GedAgentsSettings {
  enabled?: boolean;
  defaultModel?: AgentModelConfig;
  models?: Partial<Record<GedAgentRole, AgentModelConfig>>;
  allowCheckpointBypass?: boolean;
}

export interface GedRuntimeSettings {
  agents?: GedAgentsSettings;
}

export interface ModelAvailability {
  isAvailable(modelId: string): boolean;
}

export interface SyncGedSubagentRuntimeOptions {
  modelAvailability?: ModelAvailability;
}

export interface EffectiveGedAgentsSettings {
  enabled: boolean;
  defaultModel?: AgentModelConfig;
  models: Partial<Record<GedAgentRole, AgentModelConfig>>;
  allowCheckpointBypass: boolean;
}

export function globalGedSettingsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".gedcode", "settings.json");
}

export function projectGedSettingsPath(rootDir: string): string {
  return path.join(rootDir, ".gedcode", "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelConfig(value: unknown): AgentModelConfig | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.model === "string") {
    const config: Record<string, unknown> = { ...value, model: value.model };
    if (Array.isArray(value.fallback)) {
      config.fallback = value.fallback
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim());
    }
    return config as AgentModelConfig;
  }
  return undefined;
}

export function cleanAgentsSettings(value: unknown): GedAgentsSettings {
  if (!isRecord(value)) {
    return {};
  }

  const settings: GedAgentsSettings = {};
  if (typeof value.enabled === "boolean") {
    settings.enabled = value.enabled;
  }
  const defaultModel = parseModelConfig(value.defaultModel);
  if (defaultModel) {
    settings.defaultModel = defaultModel;
  }

  if (isRecord(value.models)) {
    const models: Partial<Record<GedAgentRole, AgentModelConfig>> = {};
    for (const role of GED_AGENT_ROLES) {
      const model = parseModelConfig(value.models[role]);
      if (model) {
        models[role] = model;
      }
    }
    if (Object.keys(models).length > 0) {
      settings.models = models;
    }
  }

  if (typeof value.allowCheckpointBypass === "boolean") {
    settings.allowCheckpointBypass = value.allowCheckpointBypass;
  }

  return settings;
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function readGedRuntimeSettings(
  filePath: string,
): Promise<GedRuntimeSettings> {
  const raw = await readJson(filePath);
  return { agents: cleanAgentsSettings(raw.agents) };
}

export async function readEffectiveGedAgentsSettings(
  rootDir: string,
  options: { homeDir?: string } = {},
): Promise<EffectiveGedAgentsSettings> {
  const [globalSettings, projectSettings] = await Promise.all([
    readGedRuntimeSettings(globalGedSettingsPath(options.homeDir)),
    readGedRuntimeSettings(projectGedSettingsPath(rootDir)),
  ]);
  const globalAgents = globalSettings.agents ?? {};
  const projectAgents = projectSettings.agents ?? {};

  return {
    enabled: projectAgents.enabled ?? globalAgents.enabled ?? false,
    defaultModel: projectAgents.defaultModel ?? globalAgents.defaultModel,
    models: {
      ...(globalAgents.models ?? {}),
      ...(projectAgents.models ?? {}),
    },
    allowCheckpointBypass:
      projectAgents.allowCheckpointBypass ??
      globalAgents.allowCheckpointBypass ??
      false,
  };
}

export async function writeGedAgentsSettings(
  filePath: string,
  agents: GedAgentsSettings,
): Promise<void> {
  const existing = await readJson(filePath);
  const next = {
    ...existing,
    agents: cleanAgentsSettings(agents),
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

export function formatGedAgentsStatus(
  effective: EffectiveGedAgentsSettings,
): string {
  const modelLines = GED_AGENT_ROLES.map((role) => {
    const config =
      effective.models[role] ?? effective.defaultModel ?? "inherit";
    const modelLabel = formatModelConfig(
      config === "inherit" ? undefined : config,
    );
    const thinking = thinkingLevel(config === "inherit" ? undefined : config);
    const thinkingTag = thinking ? ` [thinking: ${thinking}]` : "";
    return `- ${role}: ${modelLabel}${thinkingTag}`;
  });
  return [
    `Subagents: ${effective.enabled ? "enabled" : "disabled"}`,
    `Default model: ${formatModelConfig(effective.defaultModel)}`,
    "Role models:",
    ...modelLines,
    "Allowed roles: ged-explorer, ged-planner, ged-verifier",
    "Writer roles: disabled/not registered",
  ].join("\n");
}

function modelId(value: AgentModelConfig | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.model;
}

export function modelCandidates(value: AgentModelConfig | undefined): string[] {
  const primary = modelId(value);
  if (!primary) return [];
  return [...new Set([primary, ...fallbackChain(value)])];
}

export function selectAgentModel(
  value: AgentModelConfig | undefined,
  availability?: ModelAvailability,
): string | undefined {
  const candidates = modelCandidates(value);
  if (candidates.length === 0) return undefined;
  if (!availability) return candidates[0];
  return candidates.find((candidate) => availability.isAvailable(candidate));
}

function fallbackChain(value: AgentModelConfig | undefined): string[] {
  if (!value || typeof value === "string") return [];
  const fb = value.fallback;
  return Array.isArray(fb)
    ? fb.filter((item): item is string => typeof item === "string")
    : [];
}

function thinkingLevel(
  value: AgentModelConfig | undefined,
): string | undefined {
  if (!value || typeof value === "string") return undefined;
  const thinking = value.thinking;
  if (typeof thinking === "string") {
    const normalized = thinking.trim();
    if (ALLOWED_THINKING_LEVELS.has(normalized)) return normalized;
  }
  return undefined;
}

function formatModelConfig(value: AgentModelConfig | undefined): string {
  if (!value) return "inherit orchestrator";
  if (typeof value === "string") return value;
  const primary = value.model;
  const fb = fallbackChain(value);
  if (fb.length === 0) return primary;
  return `${primary} → ${fb.join(" → ")}`;
}

function bundledRolePrompt(
  role: GedAgentRole,
  effective: EffectiveGedAgentsSettings,
  availability?: ModelAvailability,
): string {
  const model = selectAgentModel(
    effective.models[role] ?? effective.defaultModel,
    availability,
  );
  const modelLine = model ? `model: ${model}\n` : "";
  const thinking = thinkingLevel(
    effective.models[role] ?? effective.defaultModel,
  );
  const thinkingLine = thinking ? `thinking: ${thinking}\n` : "";
  const commonFrontmatter = `${modelLine}${thinkingLine}tools: read, bash, grep, find, ls\ndisallowed_tools: write, edit, multi_edit, patch, apply_patch\nextensions: false\nskills: false\nprompt_mode: replace\nrun_in_background: true\n`;
  const prompts: Record<GedAgentRole, string> = {
    "ged-explorer": `---
description: Read-only Ged codebase scout for evidence-backed discovery packets.
${commonFrontmatter}---

# Ged Explorer

You are a read-only intelligence contributor for GedPi. Your job is comprehensive reconnaissance — gather as much relevant context as you can before the main agent burns expensive tokens on planning.

**What to do:**
- Map the file structure: key directories, entry points, configuration files
- Identify key types, interfaces, and data structures
- Trace dependency graphs and import chains
- Spot recurring patterns, conventions, and architectural boundaries
- Find relevant tests, documentation, and configuration
- Report everything with file paths and line references

**Output format:**
- **Files inspected:** list every file you read
- **Key findings:** types, patterns, dependencies, conventions
- **Risks / edge cases:** anything fragile, complex, or surprising
- **Open questions:** what still needs investigation
- **Suggested next inspection:** files the main agent should prioritize

Maximize coverage within your budget. Prefer breadth-first scan, then go deep on likely hot paths. The main agent will synthesize your findings. Never edit files, write plans, commit, push, or make scope decisions.
`,
    "ged-planner": `---
description: Read-only Ged smart-friend planner that critiques plans and test seams.
${commonFrontmatter}---

# Ged Planner

You are a read-only planning critic for GedPi. Your job is to critique plans and identify missing context — but you must NOT critique a plan when the dispatch is semantically under-specified.

**Before planning, check semantic sufficiency across the entire dispatch.** Do not require an exact heading or magic phrase. Consider all user messages, plan text, approval notes, \`.ged/\` excerpts, explorer findings, and any explicit clarification evidence supplied in the dispatch.

Proceed only when the dispatch contains enough information to understand:
- goal/problem to solve
- users or impacted audience (for internal/tooling work, identify the maintainer/operator/agent audience)
- scope and non-goals or boundaries
- constraints, risks, or acceptance/test expectations
- relevant implementation context needed to critique the plan

If important information is missing or too vague, refuse to critique. Name the missing dimensions and tell the main agent to run a grill-me session for those gaps, update the plan, obtain any required user plan approval, and re-dispatch you. Do not demand a specific \`## Grill-me evidence\` block.

If the dispatch is semantically sufficient, proceed: identify missing questions, constraints, edge cases, non-goals, and test seams. Critique the plan and suggest improvements.

Never edit files, write planning artifacts, implement, commit, push, or open PRs.
`,
    "ged-verifier": `---
description: Read-only Ged clean-context reviewer for diffs and verification evidence.
${commonFrontmatter}---

# Ged Verifier

You are a read-only clean-context reviewer for GedPi. Inspect diffs, tests, and verification evidence. Report findings with evidence, confidence, suggested fixes, and commit-blocking status. Never edit files, commit, push, open PRs, or adjudicate acceptance.
`,
  };
  return prompts[role];
}

export async function syncGedSubagentRuntimeConfig(
  rootDir: string,
  options: SyncGedSubagentRuntimeOptions = {},
): Promise<void> {
  await ensureIgnoredInGitignore(rootDir, ".gedcode/");
  const effective = await readEffectiveGedAgentsSettings(rootDir);
  const agentsDir = path.join(rootDir, ".pi", "agents");

  if (!effective.enabled) {
    await Promise.all(
      GED_AGENT_ROLES.map((role) =>
        rm(path.join(agentsDir, `${role}.md`), { force: true }),
      ),
    );
    return;
  }

  await mkdir(agentsDir, { recursive: true });
  await Promise.all(
    GED_AGENT_ROLES.map((role) =>
      writeFileAtomic(
        path.join(agentsDir, `${role}.md`),
        bundledRolePrompt(role, effective, options.modelAvailability),
      ),
    ),
  );
}
