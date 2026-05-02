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
import { readGedMode } from "../src/theme.js";

describe("Ged command surface", () => {
  test("createGedCommands exposes GedPi commands", () => {
    expect(createGedCommands().map((command) => command.name)).toEqual([
      "ged-mode",
      "ged-rtk",
      "ged-agents",
    ]);
  });

  test("gedCoreExtension registers the GedPi commands", () => {
    let rendererRegistrations = 0;
    const commands: string[] = [];
    const events: string[] = [];

    gedCoreExtension({
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
    expect(commands).toEqual([
      "ged-mode",
      "ged-rtk",
      "ged-agents",
      "theme",
      "update",
    ]);
    expect(events).toContain("session_start");
    expect(events).toContain("before_agent_start");
    expect(events).toContain("tool_call");
    expect(events).toContain("turn_end");
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

  test("ged-mode command toggles the persisted mode flag", async () => {
    const command = createGedCommands()[0];
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-mode-command-"));
    const statuses: string[] = [];

    const first = await command.execute({
      cwd,
      runtime: {
        pi: {} as never,
        ctx: {
          ui: {
            setStatus(_key: string, value: string) {
              statuses.push(value);
            },
            setWidget() {},
          },
        } as never,
      },
    });

    expect(typeof first).toBe("string");
    expect(readGedMode(cwd)).toBe(true);

    await command.execute({
      cwd,
      runtime: {
        pi: {} as never,
        ctx: {
          ui: {
            setStatus(_key: string, value: string) {
              statuses.push(value);
            },
            setWidget() {},
          },
        } as never,
      },
    });

    expect(readGedMode(cwd)).toBe(false);
    expect(statuses).toHaveLength(2);
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
});
