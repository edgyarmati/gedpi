import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildInstallPlan,
  detectRtk,
  executeRtkCommand,
  registerRtkBashRouting,
} from "../src/rtk.js";
import { readRtkMode } from "../src/theme.js";

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

  test("executeRtkCommand enables auto mode when RTK is installed", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ged-rtk-on-"));

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

    expect(message).toContain("RTK routing is now ON");
    expect(readRtkMode(cwd)).toBe("auto");
  });

  test("registerRtkBashRouting rewrites bash commands only in auto mode", async () => {
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
    expect(bashEvent.input.command).toBe("git status");

    await executeRtkCommand(
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

    await handler?.(bashEvent, { cwd });
    expect(bashEvent.input.command).toBe("rtk git status");
  });
});
