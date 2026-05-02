import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import type { GedConfig } from "./contracts.js";
import { AVAILABLE_MODELS } from "./providers.js";

export const DEFAULT_CONFIG: GedConfig = {
  models: {
    brain: "anthropic/claude-opus-4-6",
  },
  cleanupCompletedPlans: false,
};

export const CONFIG_PATH = ".ged/CONFIG.md";

function parseModelTable(
  content: string,
  heading: string,
): Record<string, string> {
  const sectionRegex = new RegExp(
    `${heading}\\n\\n\\| Agent \\| Model \\|\\n\\|-+\\|-+\\|\\n([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const match = content.match(sectionRegex);
  if (!match?.[1]) {
    return {};
  }

  const models: Record<string, string> = {};
  const lines = match[1].trim().split("\n");
  for (const line of lines) {
    const rowMatch = line.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|/u);
    if (rowMatch) {
      const agent = rowMatch[1].trim().toLowerCase();
      const model = rowMatch[2].trim();
      if (model.length > 0) {
        models[agent] = model;
      }
    }
  }
  return models;
}

function parseCleanupCompletedPlans(content: string): boolean {
  const match = content.match(/Delete completed plan files:\s*(true|false)/u);
  return match ? match[1] === "true" : DEFAULT_CONFIG.cleanupCompletedPlans;
}

export async function readConfig(rootDir: string): Promise<GedConfig> {
  const configPath = path.join(rootDir, CONFIG_PATH);
  try {
    const content = await readFile(configPath, "utf8");
    const models = parseModelTable(content, "## Models");

    return {
      models: {
        brain: models.brain ?? DEFAULT_CONFIG.models.brain,
      },
      cleanupCompletedPlans: parseCleanupCompletedPlans(content),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function renderConfigContent(config: GedConfig): string {
  return `# GedPi Configuration

## Models

| Agent | Model |
|-------|-------|
| brain | ${config.models.brain} |

## Memory

Delete completed plan files: ${config.cleanupCompletedPlans}
`;
}

export async function writeConfig(
  rootDir: string,
  config: GedConfig,
): Promise<void> {
  const configPath = path.join(rootDir, CONFIG_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFileAtomic(configPath, renderConfigContent(config));
}

export async function updateModelConfig(
  rootDir: string,
  agent: string,
  model: string,
): Promise<GedConfig> {
  const config = await readConfig(rootDir);
  const validAgents = ["brain"] as const;
  const normalizedAgent = agent.toLowerCase() as (typeof validAgents)[number];

  if (!validAgents.includes(normalizedAgent)) {
    throw new Error(
      `Invalid agent: ${agent}. Valid agents: ${validAgents.join(", ")}`,
    );
  }

  config.models[normalizedAgent] = model;
  await writeConfig(rootDir, config);
  return config;
}

export { AVAILABLE_MODELS };
