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

export type AgentModelConfig =
  | string
  | ({ model: string } & Record<string, unknown>);

export interface GedAgentsSettings {
  enabled?: boolean;
  defaultModel?: AgentModelConfig;
  models?: Partial<Record<GedAgentRole, AgentModelConfig>>;
}

export interface GedRuntimeSettings {
  agents?: GedAgentsSettings;
}

export interface EffectiveGedAgentsSettings {
  enabled: boolean;
  defaultModel?: AgentModelConfig;
  models: Partial<Record<GedAgentRole, AgentModelConfig>>;
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
    return { ...value, model: value.model } as AgentModelConfig;
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
    const model = effective.models[role] ?? effective.defaultModel ?? "inherit";
    const label = typeof model === "string" ? model : JSON.stringify(model);
    return `- ${role}: ${label}`;
  });
  return [
    `Subagents: ${effective.enabled ? "enabled" : "disabled"}`,
    `Default model: ${effective.defaultModel ? (typeof effective.defaultModel === "string" ? effective.defaultModel : JSON.stringify(effective.defaultModel)) : "inherit orchestrator"}`,
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

function bundledRolePrompt(
  role: GedAgentRole,
  effective: EffectiveGedAgentsSettings,
): string {
  const model = modelId(effective.models[role] ?? effective.defaultModel);
  const modelLine = model ? `model: ${model}\n` : "";
  const prompts: Record<GedAgentRole, string> = {
    "ged-explorer": `---
name: ged-explorer
description: Read-only Ged codebase scout for evidence-backed discovery packets.
${modelLine}tools: read, grep, glob, bash
inheritProjectContext: true
inheritSkills: false
systemPromptMode: replace
---

# Ged Explorer

You are a read-only intelligence contributor for GedPi. Search and read repository files, run only non-mutating inspection commands, and return evidence-backed findings. Never edit files, write plans, commit, push, open PRs, or make scope decisions.
`,
    "ged-planner": `---
name: ged-planner
description: Read-only Ged smart-friend planner that critiques plans and test seams.
${modelLine}tools: read, grep, glob, bash
inheritProjectContext: true
inheritSkills: false
systemPromptMode: replace
---

# Ged Planner

You are a read-only planning critic for GedPi. Identify missing questions, constraints, edge cases, non-goals, and test seams. Never edit files, write planning artifacts, implement, commit, push, or open PRs.
`,
    "ged-verifier": `---
name: ged-verifier
description: Read-only Ged clean-context reviewer for diffs and verification evidence.
${modelLine}tools: read, grep, glob, bash
inheritProjectContext: true
inheritSkills: false
systemPromptMode: replace
---

# Ged Verifier

You are a read-only clean-context reviewer for GedPi. Inspect diffs, tests, and verification evidence. Report findings with evidence, confidence, suggested fixes, and commit-blocking status. Never edit files, commit, push, open PRs, or adjudicate acceptance.
`,
  };
  return prompts[role];
}

async function writeJsonMerged(
  filePath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await readJson(filePath);
  const existingSubagents = isRecord(existing.subagents)
    ? existing.subagents
    : {};
  const patchSubagents = isRecord(patch.subagents)
    ? patch.subagents
    : undefined;
  const next = {
    ...existing,
    ...patch,
    ...(patchSubagents
      ? { subagents: { ...existingSubagents, ...patchSubagents } }
      : {}),
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function syncGedSubagentRuntimeConfig(
  rootDir: string,
): Promise<void> {
  await ensureIgnoredInGitignore(rootDir, ".gedcode/");
  const effective = await readEffectiveGedAgentsSettings(rootDir);
  const agentsDir = path.join(rootDir, ".pi", "agents");
  const piSettingsPath = path.join(rootDir, ".pi", "settings.json");

  if (!effective.enabled) {
    await Promise.all(
      GED_AGENT_ROLES.map((role) =>
        rm(path.join(agentsDir, `${role}.md`), { force: true }),
      ),
    );
    await writeJsonMerged(piSettingsPath, {
      subagents: { disableBuiltins: true },
    });
    return;
  }

  await mkdir(agentsDir, { recursive: true });
  await Promise.all(
    GED_AGENT_ROLES.map((role) =>
      writeFileAtomic(
        path.join(agentsDir, `${role}.md`),
        bundledRolePrompt(role, effective),
      ),
    ),
  );
  await writeJsonMerged(piSettingsPath, {
    subagents: { disableBuiltins: true },
  });
}
