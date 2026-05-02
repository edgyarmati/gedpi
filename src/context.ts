import { readFile } from "node:fs/promises";
import path from "node:path";

import type { GedPhase, TaskBrief } from "./contracts.js";
import { GED_DIR } from "./contracts.js";

const CHARS_PER_TOKEN = 4;

export interface TokenBudget {
  maxTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function createBudget(maxTokens: number): TokenBudget {
  return { maxTokens, usedTokens: 0, remainingTokens: maxTokens };
}

export function consumeBudget(budget: TokenBudget, text: string): TokenBudget {
  const tokens = estimateTokens(text);
  const usedTokens = budget.usedTokens + tokens;
  return {
    maxTokens: budget.maxTokens,
    usedTokens,
    remainingTokens: Math.max(0, budget.maxTokens - usedTokens),
  };
}

export function fitsInBudget(budget: TokenBudget, text: string): boolean {
  return estimateTokens(text) <= budget.remainingTokens;
}

const PHASE_FILES: Record<GedPhase, string[]> = {
  understand: ["PROJECT.md", "IDEAS.md", "SESSION-SUMMARY.md", "PROGRESS.md"],
  plan: [
    "PROJECT.md",
    "SPEC.md",
    "TASKS.md",
    "DECISIONS.md",
    "SESSION-SUMMARY.md",
  ],
  build: ["SPEC.md", "TASKS.md", "TESTS.md", "PROGRESS.md"],
  check: ["TESTS.md", "TASKS.md", "SPEC.md"],
  escalate: [
    "SPEC.md",
    "TASKS.md",
    "TESTS.md",
    "DECISIONS.md",
    "SESSION-SUMMARY.md",
    "PROGRESS.md",
  ],
};

export function getPhaseFiles(phase: GedPhase): string[] {
  return PHASE_FILES[phase];
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export interface ContextBlock {
  file: string;
  content: string;
  tokens: number;
}

export async function gatherPhaseContext(
  rootDir: string,
  phase: GedPhase,
  maxTokens: number,
): Promise<ContextBlock[]> {
  const files = getPhaseFiles(phase);
  let budget = createBudget(maxTokens);
  const blocks: ContextBlock[] = [];

  for (const file of files) {
    const content = await safeReadFile(path.join(rootDir, GED_DIR, file));
    if (!content) continue;
    if (!fitsInBudget(budget, content)) continue;

    budget = consumeBudget(budget, content);
    blocks.push({
      file,
      content,
      tokens: estimateTokens(content),
    });
  }

  return blocks;
}

export async function gatherTaskContext(
  rootDir: string,
  task: TaskBrief,
  maxTokens: number,
): Promise<ContextBlock[]> {
  const coreFiles = ["SPEC.md", "TESTS.md"];
  let budget = createBudget(maxTokens);
  const blocks: ContextBlock[] = [];

  // Core ged files first
  for (const file of coreFiles) {
    const content = await safeReadFile(path.join(rootDir, GED_DIR, file));
    if (!content) continue;
    if (!fitsInBudget(budget, content)) continue;

    budget = consumeBudget(budget, content);
    blocks.push({ file, content, tokens: estimateTokens(content) });
  }

  // Task brief
  const briefPath = path.join(rootDir, GED_DIR, "tasks", `${task.id}-BRIEF.md`);
  const briefContent = await safeReadFile(briefPath);
  if (briefContent && fitsInBudget(budget, briefContent)) {
    budget = consumeBudget(budget, briefContent);
    blocks.push({
      file: `tasks/${task.id}-BRIEF.md`,
      content: briefContent,
      tokens: estimateTokens(briefContent),
    });
  }

  // Context files from the task definition
  for (const file of task.contextFiles) {
    const content = await safeReadFile(path.join(rootDir, file));
    if (!content) continue;
    if (!fitsInBudget(budget, content)) continue;

    budget = consumeBudget(budget, content);
    blocks.push({ file, content, tokens: estimateTokens(content) });
  }

  return blocks;
}

export function renderContextBlocks(blocks: ContextBlock[]): string {
  if (blocks.length === 0) return "";

  return blocks
    .map(
      (block) =>
        `--- ${block.file} (${block.tokens} tokens) ---\n${block.content}`,
    )
    .join("\n\n");
}

export function renderContextSummary(blocks: ContextBlock[]): string {
  const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
  const fileList = blocks.map((b) => `${b.file} (${b.tokens}t)`).join(", ");
  return `Pre-loaded context: ${totalTokens} tokens from ${blocks.length} files: ${fileList}`;
}
