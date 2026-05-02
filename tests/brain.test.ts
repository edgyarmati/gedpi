import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import gedCoreExtension from "../extensions/ged-core/index.js";
import {
  buildBrainSystemPromptSuffix,
  buildPassiveGedPromptSuffix,
  ensureGedReady,
} from "../src/brain.js";
import { saveGedMode } from "../src/theme.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Ged brain runtime", () => {
  test("ensureGedReady bootstraps .ged when ged mode is enabled", async () => {
    const rootDir = await createTempProject("ged-brain-init-");

    const result = await ensureGedReady(rootDir);
    const state = await readFile(
      path.join(rootDir, ".ged", "STATE.md"),
      "utf8",
    );

    expect(result.status).toBe("initialized");
    expect(state).toContain("Run onboarding interview");
  });

  test("buildBrainSystemPromptSuffix includes the single-brain workflow and durable files", async () => {
    const rootDir = await createTempProject("ged-brain-prompt-");
    await ensureGedReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir);

    expect(prompt).toContain("GedPi Single-Brain Mode");
    expect(prompt).toContain("Interview the user until the requested behavior");
    expect(prompt).toContain(
      "use the interview tool to ask targeted clarification questions instead of asking them in chat",
    );
    expect(prompt).toContain(
      "treat direct user instructions as requested Ged app/product behavior by default",
    );
    expect(prompt).toContain(".ged/TASKS.md");
    expect(prompt).toContain("Run onboarding interview");
  });

  test("buildPassiveGedPromptSuffix excludes workflow files and keeps durable guidance", async () => {
    const rootDir = await createTempProject("ged-brain-passive-");
    await ensureGedReady(rootDir);

    const prompt = await buildPassiveGedPromptSuffix(rootDir);

    expect(prompt).toContain("Ged Durable Standards");
    expect(prompt).toContain(".ged/PROJECT.md");
    expect(prompt).not.toContain("### .ged/TASKS.md");
    expect(prompt).not.toContain("### .ged/TESTS.md");
  });

  test("gedCoreExtension leaves ged init off by default and only injects passive prompt", async () => {
    const rootDir = await createTempProject("ged-brain-ext-");
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const statuses: Array<string | undefined> = [];
    const sentMessages: string[] = [];

    gedCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendUserMessage(message: string) {
        sentMessages.push(message);
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    await handlers.get("session_start")?.(
      { type: "session_start" },
      {
        cwd: rootDir,
        ui: {
          setTitle() {},
          setTheme() {},
          setHeader() {},
          notify() {},
          setStatus(_key: string, value: string | undefined) {
            statuses.push(value);
          },
        },
      },
    );
    const beforeStart = (await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "Build me a todo app",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    )) as { systemPrompt: string };

    expect(statuses).toHaveLength(3);
    expect(sentMessages).toHaveLength(0);
    expect(beforeStart.systemPrompt).toContain("BASE");
    expect(beforeStart.systemPrompt).not.toContain("GedPi Single-Brain Mode");
  });

  test("gedCoreExtension initializes and injects workflow prompt when ged mode is on", async () => {
    const rootDir = await createTempProject("ged-brain-ext-on-");
    saveGedMode(rootDir, true);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    gedCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendMessage() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    const beforeStart = (await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "Build me a todo app",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    )) as { systemPrompt: string };

    expect(beforeStart.systemPrompt).toContain("GedPi Single-Brain Mode");
    expect(beforeStart.systemPrompt).toContain(
      "use the interview tool now to run a concise onboarding interview",
    );
  });
});
