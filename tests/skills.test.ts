import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { TaskBrief } from "../src/contracts.js";
import {
  BUNDLED_GED_SKILLS,
  defaultSkillSignals,
  ensureTaskSkillDependencies,
  matchSkillsForTask,
} from "../src/skills.js";

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

describe("bundled skill registration", () => {
  test("grill-with-docs is a recommended bundled Ged skill", () => {
    expect(BUNDLED_GED_SKILLS.has("grill-with-docs")).toBe(true);
    expect(defaultSkillSignals).toContainEqual(
      expect.objectContaining({
        label: "grill-with-docs",
        policy: "recommend-only",
      }),
    );
  });

  test("domain documentation tasks match grill-with-docs triggers", () => {
    const task: TaskBrief = {
      id: "T1",
      title: "Clarify domain terminology",
      objective: "Update glossary and ADR wording for the domain model",
      contextFiles: [],
      skills: [],
      doneCriteria: ["CONTEXT.md captures canonical terms"],
      status: "todo",
      dependsOn: [],
    };

    const matched = matchSkillsForTask(task, [
      {
        name: "grill-with-docs",
        triggers: ["domain", "glossary", "ADR", "CONTEXT.md"],
        content: "",
      },
    ]);

    expect(matched.map((skill) => skill.name)).toEqual(["grill-with-docs"]);
  });
});

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
