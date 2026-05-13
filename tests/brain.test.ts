import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import gedCoreExtension from "../extensions/ged-core/index.js";
import {
  buildBrainSystemPromptSuffix,
  buildBranchNudge,
  buildPassiveGedPromptSuffix,
  ensureGedReady,
  TRUNK_BRANCHES,
} from "../src/brain.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function enableProjectSubagents(rootDir: string): Promise<void> {
  const settingsDir = path.join(rootDir, ".gedcode");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    path.join(settingsDir, "settings.json"),
    JSON.stringify({ agents: { enabled: true } }),
  );
}

async function createTempHomeWithPreferences(
  prefs: Record<string, string>,
): Promise<string> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "ged-home-"));
  const gedcodeDir = path.join(homeDir, ".gedcode");
  await mkdir(gedcodeDir, { recursive: true });
  await writeFile(
    path.join(gedcodeDir, "settings.json"),
    JSON.stringify({ preferences: prefs }),
  );
  return homeDir;
}

describe("Ged brain runtime", () => {
  let testHomeDir: string;

  beforeEach(async () => {
    testHomeDir = await createTempHomeWithPreferences({
      autoCommitVerifiedWork: "ask",
      reviewPlanBeforePlannerHandoff: "plannotator",
    });
  });

  afterEach(async () => {
    // Cleanup handled by OS tmp dirs.
  });

  test("ensureGedReady bootstraps .ged when ged mode is enabled", async () => {
    const rootDir = await createTempProject("ged-brain-init-");

    const result = await ensureGedReady(rootDir);
    const state = await readFile(
      path.join(rootDir, ".ged", "runtime", "root", "STATE.md"),
      "utf8",
    );

    expect(result.status).toBe("initialized");
    expect(state).toContain("Run onboarding clarification");
  });

  test("buildBrainSystemPromptSuffix includes the subagent workflow and durable files", async () => {
    const rootDir = await createTempProject("ged-brain-prompt-");
    await ensureGedReady(rootDir);
    await enableProjectSubagents(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir, {
      homeDir: testHomeDir,
    });

    expect(prompt).toContain("GedPi Single-Brain Mode");
    expect(prompt).toContain("use grill-me in chat");
    expect(prompt).toContain(
      "Do not dispatch ged-planner before this first-pass clarification/sufficiency check",
    );
    expect(prompt).toContain("synthesize the clarification evidence");
    expect(prompt).toContain("skill-fit checkpoint");
    expect(prompt).toContain("## Plan Review Preference");
    expect(prompt).toContain(
      "Current setting: Review with Plannotator (plannotator)",
    );
    expect(prompt).toContain("request Plannotator plan review");
    expect(prompt).toContain("fall back to chat approval");
    expect(prompt).toContain(
      "judging semantic sufficiency across the whole dispatch",
    );
    expect(prompt).toContain("## Commit Preference");
    expect(prompt).toContain("Current setting: ask");
    expect(prompt).toContain("ask the user whether to commit");
    expect(prompt).toContain("use find-skills if coverage is insufficient");
    expect(prompt).not.toContain("interview tool");
    expect(prompt).toContain(
      "treat direct user instructions as requested Ged app/product behavior by default",
    );
    expect(prompt).toContain(".ged/work/root/TASKS.md");
    expect(prompt).toContain("Run onboarding clarification");
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

  describe("buildBranchNudge", () => {
    test("returns nudge for main branch", () => {
      const nudge = buildBranchNudge("main");
      expect(nudge).toContain("## ⚠️ Branch Hygiene");
      expect(nudge).toContain("`main`");
      expect(nudge).toContain("feature branch");
      expect(nudge).toContain("git checkout -b");
    });

    test("returns nudge for master branch", () => {
      const nudge = buildBranchNudge("master");
      expect(nudge).toContain("## ⚠️ Branch Hygiene");
      expect(nudge).toContain("`master`");
      expect(nudge).toContain("feature branch");
    });

    test("returns nudge for root work-id", () => {
      const nudge = buildBranchNudge("root");
      expect(nudge).toContain("## ⚠️ Branch Hygiene");
      expect(nudge).toContain("No named Git branch");
      expect(nudge).toContain("`root` work namespace");
      expect(nudge).not.toContain("feature branch");
    });

    test("returns empty string for feature branches", () => {
      expect(buildBranchNudge("feat-foo")).toBe("");
      expect(buildBranchNudge("fix-bar")).toBe("");
      expect(buildBranchNudge("chore/update-deps")).toBe("");
      expect(buildBranchNudge("feature/my-cool-thing")).toBe("");
    });

    test("returns empty string for empty work-id", () => {
      expect(buildBranchNudge("")).toBe("");
    });

    test("TRUNK_BRANCHES contains expected values", () => {
      expect(TRUNK_BRANCHES.has("main")).toBe(true);
      expect(TRUNK_BRANCHES.has("master")).toBe(true);
      expect(TRUNK_BRANCHES.has("root")).toBe(true);
      expect(TRUNK_BRANCHES.size).toBe(3);
    });
  });

  test("buildBrainSystemPromptSuffix includes branch nudge when no git repo (root work-id)", async () => {
    const rootDir = await createTempProject("ged-brain-nudge-");
    await ensureGedReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir, {
      homeDir: testHomeDir,
    });

    expect(prompt).toContain("## ⚠️ Branch Hygiene");
    expect(prompt).toContain("No named Git branch");
    expect(prompt).toContain("`root` work namespace");
    // Nudge should appear before the passive durable standards section
    const nudgeIndex = prompt.indexOf("## ⚠️ Branch Hygiene");
    const standardsIndex = prompt.indexOf("## Ged Durable Standards");
    expect(nudgeIndex).toBeLessThan(standardsIndex);
  });

  test("buildBrainSystemPromptSuffix omits branch nudge on feature branch", async () => {
    const rootDir = await createTempProject("ged-brain-feat-");
    execSync("git init -b feat/my-work", { cwd: rootDir });
    execSync('git config user.email "test@gedpi.dev"', { cwd: rootDir });
    execSync('git config user.name "GedPi Test"', { cwd: rootDir });
    execSync("git commit --allow-empty -m 'initial'", { cwd: rootDir });
    await ensureGedReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir, {
      homeDir: testHomeDir,
    });

    expect(prompt).not.toContain("## ⚠️ Branch Hygiene");
  });

  test("buildBrainSystemPromptSuffix includes branch nudge on main branch", async () => {
    const rootDir = await createTempProject("ged-brain-main-");
    execSync("git init -b main", { cwd: rootDir });
    execSync('git config user.email "test@gedpi.dev"', { cwd: rootDir });
    execSync('git config user.name "GedPi Test"', { cwd: rootDir });
    execSync("git commit --allow-empty -m 'initial'", { cwd: rootDir });
    await ensureGedReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir, {
      homeDir: testHomeDir,
    });

    expect(prompt).toContain("## ⚠️ Branch Hygiene");
    expect(prompt).toContain("`main`");
  });

  test("buildBrainSystemPromptSuffix includes branch nudge on master branch", async () => {
    const rootDir = await createTempProject("ged-brain-master-");
    execSync("git init -b master", { cwd: rootDir });
    execSync('git config user.email "test@gedpi.dev"', { cwd: rootDir });
    execSync('git config user.name "GedPi Test"', { cwd: rootDir });
    execSync("git commit --allow-empty -m 'initial'", { cwd: rootDir });
    await ensureGedReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir, {
      homeDir: testHomeDir,
    });

    expect(prompt).toContain("## ⚠️ Branch Hygiene");
    expect(prompt).toContain("`master`");
  });

  test("gedCoreExtension initializes and injects the subagent workflow prompt", async () => {
    const rootDir = await createTempProject("ged-brain-ext-");
    await enableProjectSubagents(rootDir);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    await gedCoreExtension({
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

    await handlers.get("session_start")?.(
      { type: "session_start" },
      {
        cwd: rootDir,
        ui: {
          setTitle() {},
          setTheme() {},
          setHeader() {},
          notify() {},
          setStatus() {},
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

    expect(beforeStart.systemPrompt).toContain("BASE");
    expect(beforeStart.systemPrompt).toContain("GedPi Single-Brain Mode");
    expect(beforeStart.systemPrompt).toContain("use grill-me in chat");
    expect(beforeStart.systemPrompt).toContain("## Plan Review Preference");
    expect(beforeStart.systemPrompt).toContain(
      "Review with Plannotator (plannotator)",
    );
    expect(beforeStart.systemPrompt).not.toContain("interview tool");
  });
});
