import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import {
  cleanAgentsSettings,
  formatGedAgentsStatus,
  modelCandidates,
  projectGedSettingsPath,
  readEffectiveGedAgentsSettings,
  readGedPreferences,
  selectAgentModel,
  syncGedSubagentRuntimeConfig,
  writeGedAgentsSettings,
  writeGedPreference,
} from "../src/agent-settings.js";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Ged optional agent settings", () => {
  test("reads plan-review preference modes with legacy on as chat", async () => {
    const homeDir = await tempDir("ged-preferences-home-");
    await writeGedPreference("reviewPlanBeforePlannerHandoff", "on", homeDir);

    await expect(readGedPreferences(homeDir)).resolves.toMatchObject({
      reviewPlanBeforePlannerHandoff: "chat",
    });

    await writeGedPreference(
      "reviewPlanBeforePlannerHandoff",
      "plannotator",
      homeDir,
    );
    await expect(readGedPreferences(homeDir)).resolves.toMatchObject({
      reviewPlanBeforePlannerHandoff: "plannotator",
    });
  });

  test("defaults to disabled with no configured models", async () => {
    const rootDir = await tempDir("ged-agent-settings-root-");
    const homeDir = await tempDir("ged-agent-settings-home-");

    await expect(
      readEffectiveGedAgentsSettings(rootDir, { homeDir }),
    ).resolves.toEqual({
      enabled: false,
      models: {},
      allowCheckpointBypass: false,
    });
  });

  test("merges global settings with project override", async () => {
    const rootDir = await tempDir("ged-agent-settings-root-");
    const homeDir = await tempDir("ged-agent-settings-home-");
    await writeGedAgentsSettings(
      path.join(homeDir, ".gedcode", "settings.json"),
      {
        enabled: true,
        defaultModel: "openai/gpt-5-mini",
        models: { "ged-explorer": "opencode/nemotron" },
      },
    );
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: false,
      models: {
        "ged-planner": { model: "openai/gpt-5.5", reasoningEffort: "high" },
      },
    });

    await expect(
      readEffectiveGedAgentsSettings(rootDir, { homeDir }),
    ).resolves.toEqual({
      enabled: false,
      defaultModel: "openai/gpt-5-mini",
      models: {
        "ged-explorer": "opencode/nemotron",
        "ged-planner": { model: "openai/gpt-5.5", reasoningEffort: "high" },
      },
      allowCheckpointBypass: false,
    });
  });

  test("cleans unknown and stale writer roles", async () => {
    expect(
      cleanAgentsSettings({
        enabled: true,
        models: {
          "ged-explorer": "model/a",
          "ged-worker": "model/b",
          worker: "model/c",
        },
      }),
    ).toEqual({
      enabled: true,
      models: { "ged-explorer": "model/a" },
    });
  });

  test("settings writes persist only cleaned agents values", async () => {
    const rootDir = await tempDir("ged-agent-settings-root-");
    const settingsPath = projectGedSettingsPath(rootDir);
    await writeGedAgentsSettings(settingsPath, {
      enabled: true,
      models: {
        "ged-verifier": "model/v",
        "ged-worker": "model/w",
      } as never,
    });

    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as {
      agents: { models: Record<string, unknown> };
    };
    expect(raw.agents.models).toEqual({ "ged-verifier": "model/v" });
  });

  test("selects the first available model from a fallback chain", () => {
    const config = {
      model: "provider/missing-primary",
      fallback: ["provider/missing-fallback", "provider/available"],
    };

    expect(modelCandidates(config)).toEqual([
      "provider/missing-primary",
      "provider/missing-fallback",
      "provider/available",
    ]);
    expect(
      selectAgentModel(config, {
        isAvailable: (modelId) => modelId === "provider/available",
      }),
    ).toBe("provider/available");
  });

  test("omits model selection when no configured model is available", () => {
    const config = {
      model: "provider/missing-primary",
      fallback: ["provider/missing-fallback"],
    };

    expect(
      selectAgentModel(config, {
        isAvailable: () => false,
      }),
    ).toBeUndefined();
  });

  test("runtime sync exposes only Ged read-only roles when enabled", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".pi", "settings.json"),
      JSON.stringify({
        subagents: { agentOverrides: { reviewer: { disabled: true } } },
      }),
    );
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
      defaultModel: "openai/gpt-5-mini",
      models: {
        "ged-explorer": "openai/gpt-5-mini",
        "ged-planner": "openai/gpt-5.5",
      },
    });

    await syncGedSubagentRuntimeConfig(rootDir);

    const explorer = await readFile(
      path.join(rootDir, ".pi", "agents", "ged-explorer.md"),
      "utf8",
    );
    const settings = JSON.parse(
      await readFile(path.join(rootDir, ".pi", "settings.json"), "utf8"),
    ) as { subagents: { agentOverrides: { reviewer: { disabled: boolean } } } };

    expect(explorer).toContain("description: Read-only Ged codebase scout");
    expect(explorer).toContain("model: openai/gpt-5-mini");
    expect(explorer).toContain("tools: read, bash, grep, find, ls");
    expect(explorer).toContain("disallowed_tools: write, edit");
    expect(explorer).toContain("extensions: false");
    expect(explorer).toContain("prompt_mode: replace");
    expect(explorer).toContain("run_in_background: true");
    const planner = await readFile(
      path.join(rootDir, ".pi", "agents", "ged-planner.md"),
      "utf8",
    );
    expect(planner).toContain("model: openai/gpt-5.5");
    expect(planner).toContain(
      "semantic sufficiency across the entire dispatch",
    );
    expect(planner).toContain(
      "Do not demand a specific `## Grill-me evidence` block",
    );
    expect(planner).not.toContain(
      "Does the orchestrator's dispatch include a `## Grill-me evidence` block",
    );
    expect(explorer).toContain("Never edit files");
    expect(settings.subagents).toMatchObject({
      agentOverrides: { reviewer: { disabled: true } },
    });
  });

  test("runtime sync writes configured thinking levels", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
      models: {
        "ged-planner": {
          model: "openai/gpt-5.5",
          fallback: ["anthropic/claude-opus-4.7"],
          thinking: "high",
        },
        "ged-verifier": {
          model: "anthropic/claude-opus-4.7",
          thinking: "off",
        },
      },
    });

    await syncGedSubagentRuntimeConfig(rootDir);

    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "ged-planner.md"), "utf8"),
    ).resolves.toContain("thinking: high");
    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "ged-verifier.md"), "utf8"),
    ).resolves.toContain("thinking: off");
  });

  test("runtime sync ignores invalid thinking levels", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
      models: {
        "ged-planner": { model: "openai/gpt-5.5", thinking: "bogus" },
      },
    });

    await syncGedSubagentRuntimeConfig(rootDir);

    const planner = await readFile(
      path.join(rootDir, ".pi", "agents", "ged-planner.md"),
      "utf8",
    );
    expect(planner).not.toContain("thinking: bogus");
  });

  test("status reports configured thinking including off", () => {
    expect(
      formatGedAgentsStatus({
        enabled: true,
        models: {
          "ged-planner": { model: "openai/gpt-5.5", thinking: "off" },
        },
        allowCheckpointBypass: false,
      }),
    ).toContain("- ged-planner: openai/gpt-5.5 [thinking: off]");
  });

  test("status ignores invalid thinking levels", () => {
    expect(
      formatGedAgentsStatus({
        enabled: true,
        models: {
          "ged-planner": { model: "openai/gpt-5.5", thinking: "bogus" },
        },
        allowCheckpointBypass: false,
      }),
    ).toContain("- ged-planner: openai/gpt-5.5\n");
  });

  test("runtime sync writes the first available fallback model", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
      models: {
        "ged-planner": {
          model: "provider/missing-primary",
          fallback: ["provider/available-fallback"],
        },
      },
    });

    await syncGedSubagentRuntimeConfig(rootDir, {
      modelAvailability: {
        isAvailable: (modelId) => modelId === "provider/available-fallback",
      },
    });

    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "ged-planner.md"), "utf8"),
    ).resolves.toContain("model: provider/available-fallback");
  });

  test("runtime sync omits model when no fallback candidate is available", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
      models: {
        "ged-planner": {
          model: "provider/missing-primary",
          fallback: ["provider/missing-fallback"],
        },
      },
    });

    await syncGedSubagentRuntimeConfig(rootDir, {
      modelAvailability: {
        isAvailable: () => false,
      },
    });

    const planner = await readFile(
      path.join(rootDir, ".pi", "agents", "ged-planner.md"),
      "utf8",
    );
    expect(planner).not.toContain("model:");
  });

  test("runtime sync gitignores project gedcode settings in git repos", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await mkdir(path.join(rootDir, ".git"));
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
    });

    await syncGedSubagentRuntimeConfig(rootDir);

    await expect(
      readFile(path.join(rootDir, ".gitignore"), "utf8"),
    ).resolves.toContain(".gedcode/");
  });

  test("runtime sync removes Ged roles when disabled", async () => {
    const rootDir = await tempDir("ged-agent-sync-root-");
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: true,
    });
    await syncGedSubagentRuntimeConfig(rootDir);
    await writeGedAgentsSettings(projectGedSettingsPath(rootDir), {
      enabled: false,
    });

    await syncGedSubagentRuntimeConfig(rootDir);

    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "ged-explorer.md"), "utf8"),
    ).rejects.toThrow();
  });
});
