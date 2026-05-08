import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import gedCoreExtension from "../extensions/ged-core/index.js";
import gedSkillsExtension from "../extensions/ged-skills/index.js";
import gedStatusExtension from "../extensions/ged-status/index.js";
import {
  projectGedSettingsPath,
  writeGedAgentsSettings,
} from "../src/agent-settings.js";
import { createGedCommands } from "../src/commands.js";
import { rewriteCommandWithRtk } from "../src/rtk.js";

describe("Ged command surface", () => {
  test("createGedCommands exposes GedPi commands", () => {
    expect(createGedCommands().map((command) => command.name)).toEqual([
      "ged-rtk",
      "ged-agents",
    ]);
  });

  test("gedCoreExtension registers the GedPi commands", async () => {
    let rendererRegistrations = 0;
    const commands: string[] = [];
    const events: string[] = [];

    await gedCoreExtension({
      registerMessageRenderer() {
        rendererRegistrations += 1;
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      registerShortcut() {},
      on(event: string) {
        events.push(event);
      },
    } as never);

    expect(rendererRegistrations).toBeGreaterThan(0);
    expect(commands).toEqual(["ged-rtk", "ged-agents", "update"]);
    expect(events).toContain("session_start");
    expect(events).toContain("before_agent_start");
    expect(events).toContain("tool_call");
  });

  test("status and skills extensions register no commands", () => {
    const statusRegistrations: string[] = [];
    const skillsRegistrations: string[] = [];

    gedStatusExtension({
      registerCommand(name: string) {
        statusRegistrations.push(name);
      },
    } as never);
    gedSkillsExtension({
      registerCommand(name: string) {
        skillsRegistrations.push(name);
      },
    } as never);

    expect(statusRegistrations).toEqual([]);
    expect(skillsRegistrations).toEqual([]);
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
    expect(result).toContain("ged-verifier");
    expect(result).toContain("Writer roles: disabled/not registered");
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
    expect(status).toContain("- ged-planner: openai/gpt-5.5");
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
