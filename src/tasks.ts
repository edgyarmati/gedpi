import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "./atomic.js";
import type { TaskBrief, TaskStatus } from "./contracts.js";

export function escapeTaskTableCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function unescapeTaskTableCell(value: string): string {
  return value.replace(/\\([\\|])/gu, "$1");
}

function splitMarkdownTableRow(row: string): string[] {
  const columns: string[] = [];
  let current = "";
  let escaped = false;
  let inCodeSpan = false;

  for (const char of row) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "`") {
      inCodeSpan = !inCodeSpan;
      current += char;
      continue;
    }

    if (char === "|" && !inCodeSpan) {
      columns.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += "\\";
  }

  columns.push(current.trim());
  return columns;
}

export function parseTaskRow(row: string): TaskBrief | null {
  const columns = splitMarkdownTableRow(row)
    .slice(1, -1)
    .map(unescapeTaskTableCell);

  if (columns.length !== 5 && columns.length !== 6) {
    return null;
  }

  const [id, title, dependsOn, status, doneCriteria, skills = "-"] = columns;
  return {
    id,
    title,
    objective: title,
    contextFiles: [],
    skills:
      skills === "-"
        ? []
        : skills
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
    doneCriteria:
      doneCriteria === "-"
        ? []
        : doneCriteria
            .split(";")
            .map((item) => item.trim())
            .filter(Boolean),
    status: (status as TaskStatus) || "todo",
    dependsOn:
      dependsOn === "-"
        ? []
        : dependsOn
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
  };
}

export async function readTasks(taskPath: string): Promise<TaskBrief[]> {
  const content = await readFile(taskPath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.startsWith("| T"))
    .map(parseTaskRow)
    .filter((task): task is TaskBrief => task !== null);
}

export function renderTaskTable(tasks: TaskBrief[]): string {
  const rows = tasks.map((task) => {
    const dependsOn =
      task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
    const doneCriteria =
      task.doneCriteria.length > 0 ? task.doneCriteria.join("; ") : "-";
    const skills = task.skills.length > 0 ? task.skills.join(", ") : "-";
    return `| ${escapeTaskTableCell(task.id)} | ${escapeTaskTableCell(task.title)} | ${escapeTaskTableCell(dependsOn)} | ${escapeTaskTableCell(task.status)} | ${escapeTaskTableCell(doneCriteria)} | ${escapeTaskTableCell(skills)} |`;
  });

  return `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria | Skills |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export async function writeTasks(
  taskPath: string,
  tasks: TaskBrief[],
): Promise<void> {
  await writeFileAtomic(taskPath, renderTaskTable(tasks));
}

export function findNextExecutableTask(tasks: TaskBrief[]): TaskBrief | null {
  const doneIds = new Set(
    tasks.filter((task) => task.status === "done").map((task) => task.id),
  );

  for (const task of tasks) {
    if (task.status !== "todo") {
      continue;
    }

    if (task.dependsOn.every((dependency) => doneIds.has(dependency))) {
      return task;
    }
  }

  return null;
}

export function updateTaskStatus(
  tasks: TaskBrief[],
  taskId: string,
  status: TaskStatus,
): TaskBrief[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
}

export function updateTask(
  tasks: TaskBrief[],
  taskId: string,
  nextTask: TaskBrief,
): TaskBrief[] {
  return tasks.map((task) => (task.id === taskId ? nextTask : task));
}
