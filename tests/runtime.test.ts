import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { prepareNextTaskDispatch } from "../src/work.js";
import { initializeGedProject, planGedProject } from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Ged runtime flow", () => {
  test("bundles pi-subagents and pi-intercom extensions and skills", () => {
    expect(packageJson.dependencies).toMatchObject({
      "pi-intercom": expect.any(String),
      "pi-subagents": expect.any(String),
    });
    expect(packageJson.pi.extensions).toEqual(
      expect.arrayContaining([
        "./node_modules/pi-intercom/index.ts",
        "./node_modules/pi-subagents/src/extension/index.ts",
      ]),
    );
    expect(packageJson.pi.skills).toEqual(
      expect.arrayContaining([
        "./node_modules/pi-intercom/skills",
        "./node_modules/pi-subagents/skills",
      ]),
    );
  });

  test("configured Pi extension paths exist", async () => {
    await Promise.all(
      packageJson.pi.extensions
        .filter((extensionPath) => extensionPath.includes("pi-subagents"))
        .map((extensionPath) =>
          expect(access(path.resolve(extensionPath))).resolves.toBeUndefined(),
        ),
    );
  });

  test("prepareNextTaskDispatch creates a task brief and marks the task in progress", async () => {
    const rootDir = await createTempProject("ged-runtime-dispatch-");
    await initializeGedProject(rootDir);
    await planGedProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
    });

    const dispatch = await prepareNextTaskDispatch(rootDir);
    const tasks = await readFile(
      path.join(rootDir, ".ged", "TASKS.md"),
      "utf8",
    );

    expect(dispatch.kind).toBe("ready");
    expect(dispatch.taskId).toBe("T01");
    expect(dispatch.prompt).toContain("Task: T01");
    expect(dispatch.prompt).toContain("Relevant skills:");
    expect(dispatch.message).toContain("focused implementation session");
    expect(tasks).toContain(
      "| T01 | Lock the exact user requirements | - | in_progress |",
    );
    expect(tasks).toContain("ged-planning, brainstorming");
    expect(tasks).toContain("brainstorming");
  });
});
