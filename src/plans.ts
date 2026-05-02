import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import type { PlanEntry, PlanStatus } from "./contracts.js";
import { GED_DIR } from "./contracts.js";

const PLANS_DIR = "plans";
const INDEX_FILE = "INDEX.md";
const PROGRESS_FILE = "PROGRESS.md";

function plansDir(rootDir: string): string {
  return path.join(rootDir, GED_DIR, PLANS_DIR);
}

function indexPath(rootDir: string): string {
  return path.join(rootDir, GED_DIR, PLANS_DIR, INDEX_FILE);
}

function progressPath(rootDir: string): string {
  return path.join(rootDir, GED_DIR, PROGRESS_FILE);
}

function planFilePath(rootDir: string, planId: string): string {
  return path.join(plansDir(rootDir), `${planId}.md`);
}

function generatePlanId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/gu, "");
  const seq = now.toISOString().slice(11, 19).replace(/:/gu, "");
  return `plan-${date}-${seq}`;
}

function renderPlanFile(
  entry: PlanEntry,
  description: string,
  tasks: string[],
): string {
  const taskLines =
    tasks.length > 0
      ? tasks.map((t) => `- [ ] ${t}`).join("\n")
      : "- [ ] Define tasks";
  return `# ${entry.title}

Status: ${entry.status}
Created: ${entry.createdAt}

## Description

${description}

## Tasks

${taskLines}

## Notes

-
`;
}

function parseIndexEntries(content: string): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(
      /^\|\s*\[([^\]]+)\]\([^)]+\)\s*\|\s*([^|]+)\|\s*(\w+)\s*\|\s*([^|]+)\|\s*([^|]*)\|/u,
    );
    if (match) {
      entries.push({
        id: match[1].trim(),
        title: match[2].trim(),
        status: match[3].trim() as PlanStatus,
        createdAt: match[4].trim(),
        completedAt: match[5]?.trim() || undefined,
      });
    }
  }
  return entries;
}

function renderIndex(entries: PlanEntry[]): string {
  const rows = entries.map((e) => {
    const completed = e.completedAt ?? "";
    return `| [${e.id}](${e.id}.md) | ${e.title} | ${e.status} | ${e.createdAt} | ${completed} |`;
  });
  return `# Plan Index

| ID | Title | Status | Created | Completed |
| --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export async function ensurePlansDir(rootDir: string): Promise<void> {
  await mkdir(plansDir(rootDir), { recursive: true });
}

export async function readPlanIndex(rootDir: string): Promise<PlanEntry[]> {
  try {
    const content = await readFile(indexPath(rootDir), "utf8");
    return parseIndexEntries(content);
  } catch {
    return [];
  }
}

async function writeIndex(
  rootDir: string,
  entries: PlanEntry[],
): Promise<void> {
  await ensurePlansDir(rootDir);
  await writeFileAtomic(indexPath(rootDir), renderIndex(entries));
}

export async function createPlan(
  rootDir: string,
  title: string,
  description: string,
  tasks: string[],
): Promise<PlanEntry> {
  const id = generatePlanId();
  const createdAt = new Date().toISOString().slice(0, 10);
  const entry: PlanEntry = { id, title, status: "active", createdAt };

  await ensurePlansDir(rootDir);
  await writeFileAtomic(
    planFilePath(rootDir, id),
    renderPlanFile(entry, description, tasks),
  );

  const entries = await readPlanIndex(rootDir);
  entries.push(entry);
  await writeIndex(rootDir, entries);

  return entry;
}

export async function updatePlanStatus(
  rootDir: string,
  planId: string,
  status: PlanStatus,
): Promise<PlanEntry | null> {
  const entries = await readPlanIndex(rootDir);
  const entry = entries.find((e) => e.id === planId);
  if (!entry) return null;

  entry.status = status;
  if (status === "completed" || status === "discarded") {
    entry.completedAt = new Date().toISOString().slice(0, 10);
  }

  await writeIndex(rootDir, entries);

  // Update status in the plan file itself
  try {
    const filePath = planFilePath(rootDir, planId);
    const content = await readFile(filePath, "utf8");
    const updated = content.replace(/^Status:\s*.+$/mu, `Status: ${status}`);
    await writeFileAtomic(filePath, updated);
  } catch {
    // file may have been cleaned up already
  }

  return entry;
}

export async function cleanupCompletedPlans(
  rootDir: string,
): Promise<string[]> {
  const entries = await readPlanIndex(rootDir);
  const toRemove = entries.filter(
    (e) => e.status === "completed" || e.status === "discarded",
  );
  const removed: string[] = [];

  for (const entry of toRemove) {
    try {
      await unlink(planFilePath(rootDir, entry.id));
      removed.push(entry.id);
    } catch {
      // already gone
    }
  }

  // Keep entries in index but mark them — files are gone
  await writeIndex(rootDir, entries);
  return removed;
}

export async function appendProgress(
  rootDir: string,
  message: string,
): Promise<void> {
  const filePath = progressPath(rootDir);
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const bullet = `- [${timestamp}] ${message}`;

  try {
    const content = await readFile(filePath, "utf8");
    await writeFileAtomic(filePath, `${content.trimEnd()}\n${bullet}\n`);
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(
      filePath,
      `# Progress\n\nOngoing log of project progress.\n\n${bullet}\n`,
    );
  }
}

export async function readProgress(rootDir: string): Promise<string> {
  try {
    return await readFile(progressPath(rootDir), "utf8");
  } catch {
    return "No progress recorded yet.";
  }
}

export function renderPlanIndex(entries: PlanEntry[]): string {
  if (entries.length === 0) return "No plans created yet.";

  const active = entries.filter((e) => e.status === "active");
  const completed = entries.filter((e) => e.status === "completed");
  const discarded = entries.filter((e) => e.status === "discarded");

  const lines: string[] = [];
  if (active.length > 0) {
    lines.push("Active:");
    for (const e of active) {
      lines.push(`  ${e.id}: ${e.title} (since ${e.createdAt})`);
    }
  }
  if (completed.length > 0) {
    lines.push("Completed:");
    for (const e of completed) {
      lines.push(`  ${e.id}: ${e.title} (done ${e.completedAt})`);
    }
  }
  if (discarded.length > 0) {
    lines.push("Discarded:");
    for (const e of discarded) {
      lines.push(`  ${e.id}: ${e.title}`);
    }
  }
  return lines.join("\n");
}
