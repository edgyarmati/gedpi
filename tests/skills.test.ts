import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { TaskBrief } from "../src/contracts.js";
import { ensureTaskSkillDependencies } from "../src/skills.js";

async function createTempProject(prefix: string): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(rootDir, ".ged"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".ged", "SKILLS.md"),
    `# Skills

## Installed

- None yet

## Recommended

- None yet

## Deferred

- None yet

## Rejected

- None yet

## Usage Notes

- Record why a skill was installed, recommended, or skipped.
`,
    "utf8",
  );
  return rootDir;
}

describe("project skill generation", () => {
  test("quotes generated skill frontmatter as YAML-safe scalars", async () => {
    const rootDir = await createTempProject("ged-skills-yaml-");
    const task: TaskBrief = {
      id: "T1",
      title: "API: checkout's flow",
      objective: "Handle API: checkout safely",
      contextFiles: ["src/api:checkout.ts"],
      skills: ["Unsafe YAML Skill: checkout's flow"],
      doneCriteria: ["Keeps YAML: valid"],
      status: "todo",
      dependsOn: [],
    };

    const result = await ensureTaskSkillDependencies(rootDir, task);
    const skillName = result.created[0];
    expect(skillName).toBeTruthy();

    const content = await readFile(
      path.join(rootDir, ".ged", "project-skills", skillName, "SKILL.md"),
      "utf8",
    );

    expect(content).toContain(`name: '${skillName}'`);
    expect(content).toContain(
      "description: 'Project-specific skill for API: checkout''s flow.",
    );
    expect(content).toContain('Triggers include "checkout", "flow"');
  });
});
