import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import gedCoreExtension from "../extensions/ged-core/index.js";
import {
  projectGedSettingsPath,
  readGedRuntimeSettings,
  writeGedAgentsSettings,
} from "../src/agent-settings.js";
import { createGedCommands } from "../src/commands.js";
import { rewriteCommandWithRtk } from "../src/rtk.js";

describe("Ged command surface", () => {
  test("createGedCommands exposes GedPi commands", () => {
    expect(createGedCommands().map((command) => command.name)).toEqual([
      "grill-me",
      "rtk",
      "ged-agents",
      "ged-settings",
    ]);
  });

  test("gedCoreExtension registers the GedPi commands", async () => {
    let rendererRegistrations = 0;
    const commands: string[] = [];
    const events: string[] = [];
    const emittedEvents: Array<{ channel: string; data: unknown }> = [];

    await gedCoreExtension({
      registerMessageRenderer() {
        rendererRegistrations += 1;
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      registerShortcut() {},
      registerTool() {},
      on(event: string) {
        events.push(event);
      },
      events: {
        emit(channel: string, data: unknown) {
          emittedEvents.push({ channel, data });
        },
        on() {},
      },
    } as never);

    expect(rendererRegistrations).toBeGreaterThan(0);
    expect(commands).toEqual([
      "grill-me",
      "rtk",
      "ged-agents",
      "ged-settings",
      "update",
    ]);
    expect(events).toContain("session_start");
    expect(events).toContain("before_agent_start");
    expect(events).toContain("tool_call");
  });

  test("grill-me command returns clarification instructions", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "grill-me",
    );

    const result = await command?.execute({ cwd: process.cwd(), args: [] });

    expect(result).toContain("grill-me: needed");
    expect(result).toContain("grill-me: skipped; reason:");
    expect(result).toContain("grill-with-docs");
    expect(result).toContain("Recommended answer:");
  });

  test("rewriteCommandWithRtk returns rewritten bash command when supported", async () => {
    await expect(
      rewriteCommandWithRtk("git status", process.cwd(), async () => ({
        stdout: "rtk git status\n",
        stderr: "",
        code: 0,
      })),
    ).resolves.toBe("rtk git status");

    await expect(
      rewriteCommandWithRtk("echo hi", process.cwd(), async () => ({
        stdout: "",
        stderr: "unsupported",
        code: 1,
      })),
    ).resolves.toBeNull();
  });

  test("ged-agents status reports read-only role contract", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));

    const result = await command?.execute({ cwd, args: ["status"] });

    expect(result).toMatch(/Subagents: (enabled|disabled)/u);
    expect(result).toContain("ged-explorer");
    expect(result).toContain("ged-planner");
    expect(result).toContain("ged-plan-reviewer");
    expect(result).toContain("ged-verifier");
    expect(result).toContain("ged-worker");
    expect(result).toContain("Default/builtin pi-subagents agents");
    expect(result).toContain("Worker role: optional");
  });

  test("ged-agents project toggles preserve configured models", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    await writeGedAgentsSettings(projectGedSettingsPath(cwd), {
      enabled: false,
      defaultModel: "openai/gpt-5-mini",
      models: { "ged-planner": "openai/gpt-5.5" },
    });

    await command?.execute({ cwd, args: ["on", "--project"] });
    const status = await command?.execute({ cwd, args: ["status"] });

    expect(status).toContain("Subagents: enabled");
    expect(status).toContain("Default model: openai/gpt-5-mini");
    expect(status).toContain("- ged-planner: enabled; openai/gpt-5.5");
  });

  test("ged-agents models shows current assignments", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    await writeGedAgentsSettings(projectGedSettingsPath(cwd), {
      enabled: true,
      defaultModel: "anthropic/claude-sonnet-4",
      models: { "ged-planner": "openai/gpt-5.5" },
    });

    const result = await command?.execute({ cwd, args: ["models"] });

    expect(result).toContain("ged-explorer");
    expect(result).toContain("ged-planner");
    expect(result).toContain("ged-verifier");
    expect(result).toContain("openai/gpt-5.5");
    expect(result).toContain("anthropic/claude-sonnet-4");
    expect(result).toContain("Change:");
  });

  test("ged-agents models shows configured thinking levels", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    await writeGedAgentsSettings(projectGedSettingsPath(cwd), {
      enabled: true,
      defaultModel: { model: "openai/gpt-5-mini", thinking: "minimal" },
      models: {
        "ged-planner": { model: "openai/gpt-5.5", thinking: "low" },
      },
    });

    const result = await command?.execute({ cwd, args: ["models"] });

    expect(result).toContain("ged-planner");
    expect(result).toContain("openai/gpt-5.5 [thinking: low]");
    expect(result).toContain(
      "default**: openai/gpt-5-mini [thinking: minimal]",
    );
  });

  test("ged-agents model sets per-role model", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));

    const result = await command?.execute({
      cwd,
      args: ["model", "ged-planner", "anthropic/claude-opus-4", "--project"],
    });

    expect(result).toContain("Set ged-planner model");
    expect(result).toContain("anthropic/claude-opus-4");
    expect(result).toContain("project");
  });

  test("ged-agents model sets default model", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));

    const result = await command?.execute({
      cwd,
      args: ["model", "default", "openai/gpt-5", "--project"],
    });

    expect(result).toContain("Set default model");
    expect(result).toContain("openai/gpt-5");
  });

  test("ged-agents model --clear removes per-role override", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    await writeGedAgentsSettings(projectGedSettingsPath(cwd), {
      enabled: true,
      models: { "ged-explorer": "anthropic/claude-sonnet-4" },
    });

    const result = await command?.execute({
      cwd,
      args: ["model", "ged-explorer", "--clear", "--project"],
    });

    expect(result).toContain("Cleared ged-explorer model");
  });

  test("ged-agents model rejects unknown role", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));

    const result = await command?.execute({
      cwd,
      args: ["model", "ged-writer", "anthropic/claude-sonnet-4"],
    });

    expect(result).toContain("Unknown role");
  });

  test("ged-agents configures worker, intercom, critique, thinking, and fallbacks", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    const piAgentDir = await mkdtemp(path.join(os.tmpdir(), "ged-agent-dir-"));
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = piAgentDir;

    try {
      await command?.execute({
        cwd,
        args: ["role", "ged-worker", "on", "--project"],
      });
      await command?.execute({
        cwd,
        args: ["worker", "max-parallel", "4", "--project"],
      });
      await command?.execute({
        cwd,
        args: ["worker", "worktree", "on", "--project"],
      });
      await command?.execute({ cwd, args: ["intercom", "off", "--project"] });
      await command?.execute({
        cwd,
        args: ["critique", "always", "--project"],
      });
      await command?.execute({
        cwd,
        args: ["model", "ged-worker", "openai/gpt-5-mini", "--project"],
      });
      await command?.execute({
        cwd,
        args: ["thinking", "ged-worker", "medium", "--project"],
      });
      await command?.execute({
        cwd,
        args: ["model", "ged-worker", "openai/gpt-5.5", "--project"],
      });
      await command?.execute({
        cwd,
        args: [
          "fallback",
          "ged-worker",
          "add",
          "anthropic/claude-sonnet-4",
          "--project",
        ],
      });

      const settings = await readGedRuntimeSettings(
        projectGedSettingsPath(cwd),
      );
      expect(settings.agents).toMatchObject({
        intercomBridge: false,
        critiqueMode: "always",
        roles: {
          "ged-worker": {
            enabled: true,
            model: "openai/gpt-5.5",
            thinking: "medium",
            fallback: ["anthropic/claude-sonnet-4"],
            maxParallel: 4,
            preferWorktreeIsolation: true,
          },
        },
      });
      expect(settings.agents?.models?.["ged-worker"]).toBeUndefined();
    } finally {
      if (previousPiAgentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
  });

  test("ged-agents setup stores selected thinking levels", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    const models = [
      { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek" },
      { provider: "openai", id: "gpt-5.5", name: "GPT" },
      { provider: "anthropic", id: "claude-opus-4.7", name: "Claude" },
    ];
    const selectResponses = [
      "This project only",
      "Inherit/default",
      "Low",
      "Off",
    ];
    let customIndex = 0;

    const result = await command?.execute({
      cwd,
      args: ["setup"],
      runtime: {
        pi: {} as never,
        ctx: {
          hasUI: true,
          ui: {
            select: async () => selectResponses.shift(),
            custom: async () => models[customIndex++],
            confirm: async (_title: string, summary: string) => {
              expect(summary).toContain(
                "Explorer: deepseek/deepseek-v4-flash [thinking: inherit/default]",
              );
              expect(summary).toContain(
                "Planner: openai/gpt-5.5 [thinking: low]",
              );
              expect(summary).toContain(
                "Verifier: anthropic/claude-opus-4.7 [thinking: off]",
              );
              return true;
            },
            notify: () => {},
          },
          modelRegistry: {
            getAvailable: () => models,
            find: (provider: string, id: string) =>
              models.find(
                (model) => model.provider === provider && model.id === id,
              ),
          },
        } as never,
      },
    });

    expect(result).toContain("Planner: openai/gpt-5.5 [thinking: low]");
    expect(result).toContain(
      "Verifier: anthropic/claude-opus-4.7 [thinking: off]",
    );

    const settings = await readGedRuntimeSettings(projectGedSettingsPath(cwd));
    expect(settings.agents?.models?.["ged-explorer"]).toEqual({
      model: "deepseek/deepseek-v4-flash",
      fallback: ["openai/gpt-5.5", "anthropic/claude-opus-4.7"],
    });
    expect(settings.agents?.models?.["ged-planner"]).toMatchObject({
      model: "openai/gpt-5.5",
      thinking: "low",
    });
    expect(settings.agents?.models?.["ged-verifier"]).toMatchObject({
      model: "anthropic/claude-opus-4.7",
      thinking: "off",
    });
  });

  test("ged-agents setup cancels without writing at thinking selection", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));
    const models = [{ provider: "openai", id: "gpt-5.5", name: "GPT" }];

    const result = await command?.execute({
      cwd,
      args: ["setup"],
      runtime: {
        pi: {} as never,
        ctx: {
          hasUI: true,
          ui: {
            select: async (title: string) =>
              title === "Set up Ged subagents" ? "This project only" : "Cancel",
            custom: async () => models[0],
            confirm: async () => true,
            notify: () => {},
          },
          modelRegistry: {
            getAvailable: () => models,
            find: () => models[0],
          },
        } as never,
      },
    });

    expect(result).toBe("Setup cancelled.");
    await expect(
      readGedRuntimeSettings(projectGedSettingsPath(cwd)),
    ).resolves.toEqual({
      agents: {},
    });
  });

  test("ged-agents setup returns compact commands in non-UI mode", async () => {
    const command = createGedCommands().find(
      (candidate) => candidate.name === "ged-agents",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-agents-command-"));

    const result = await command?.execute({ cwd, args: ["setup"] });

    expect(result).toContain("/ged-agents on");
    expect(result).toContain("ged-explorer");
    expect(result).toContain("ged-planner");
    expect(result).toContain("ged-verifier");
  });
});
