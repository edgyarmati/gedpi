import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildInstallPlan,
  detectRtk,
  executeRtkCommand,
  registerRtkBashRouting,
} from "../src/rtk.js";
import { ensurePiSettings } from "../src/theme.js";

describe("RTK integration", () => {
  test("detectRtk reports installed version and path", async () => {
    const status = await detectRtk(process.cwd(), async (command) => {
      if (command === "rtk") {
        return { stdout: "rtk 0.28.2\n", stderr: "", code: 0 };
      }
      return { stdout: "/usr/local/bin/rtk\n", stderr: "", code: 0 };
    });

    expect(status).toEqual({
      installed: true,
      version: "0.28.2",
      path: "/usr/local/bin/rtk",
    });
  });

  test("buildInstallPlan prefers Homebrew when available", async () => {
    const plan = await buildInstallPlan(process.cwd(), async (command) => {
      if (command === "brew") {
        return { stdout: "Homebrew 4.0.0\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "missing", code: 1 };
    });

    if (process.platform === "win32") {
      expect(plan).toBeNull();
      return;
    }

    expect(plan).toEqual({
      label: "Homebrew",
      command: "brew install rtk",
      shell: "brew",
      args: ["install", "rtk"],
    });
  });

  test("executeRtkCommand reports automatic routing for old on/off subcommands", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-rtk-auto-"));

    const message = await executeRtkCommand(
      ["on"],
      {
        cwd,
        hasUI: true,
        ui: {
          confirm: async () => true,
          notify() {},
          setStatus() {},
        },
      } as never,
      async (command) => {
        if (command === "rtk") {
          return { stdout: "rtk 0.28.2\n", stderr: "", code: 0 };
        }
        return { stdout: "/usr/local/bin/rtk\n", stderr: "", code: 0 };
      },
    );

    expect(message).toContain("RTK routing is automatic now");
  });

  test("ensurePiSettings removes stale rtkMode settings", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-rtk-settings-"));
    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    await writeFile(
      path.join(cwd, ".pi", "settings.json"),
      `${JSON.stringify({ quietStartup: false, rtkMode: "off" }, null, 2)}\n`,
    );

    await ensurePiSettings(cwd);

    const settings = JSON.parse(
      await readFile(path.join(cwd, ".pi", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings.rtkMode).toBeUndefined();
    expect(settings.theme).toBeUndefined();
    expect(settings.quietStartup).toBe(false);
  });

  test("registerRtkBashRouting rewrites bash commands automatically", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-rtk-rewrite-"));
    const handlers = new Map<
      string,
      (event: unknown, ctx: { cwd: string }) => Promise<void>
    >();

    registerRtkBashRouting(
      {
        on(
          event: string,
          handler: (event: unknown, ctx: { cwd: string }) => Promise<void>,
        ) {
          handlers.set(event, handler);
        },
      } as never,
      async () => ({ stdout: "rtk git status\n", stderr: "", code: 0 }),
    );

    const handler = handlers.get("tool_call");
    expect(handler).toBeTypeOf("function");

    const bashEvent = {
      toolName: "bash",
      input: { command: "git status" },
    };

    await handler?.(bashEvent, { cwd });
    expect(bashEvent.input.command).toBe("rtk git status");
  });

  test("registerRtkBashRouting leaves bash commands unchanged when RTK declines", async () => {
    const handlers = new Map<
      string,
      (event: unknown, ctx: { cwd: string }) => Promise<void>
    >();

    registerRtkBashRouting(
      {
        on(
          event: string,
          handler: (event: unknown, ctx: { cwd: string }) => Promise<void>,
        ) {
          handlers.set(event, handler);
        },
      } as never,
      async () => ({ stdout: "", stderr: "missing", code: 1 }),
    );

    const bashEvent = {
      toolName: "bash",
      input: { command: "git status" },
    };

    await handlers.get("tool_call")?.(bashEvent, { cwd: process.cwd() });
    expect(bashEvent.input.command).toBe("git status");
  });
});
