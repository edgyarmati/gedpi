import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeFileAtomicSync } from "./atomic.js";

const MANAGED_PROMPT_FILES = ["commit.md", "push.md"] as const;
const MANAGED_SUBDIR = "gedpi";
const LEGACY_MANAGED_SUBDIRS = ["zz-gedpi"] as const;

export function ensureBundledPromptTemplates(
  sourceDir: string,
  options?: {
    homeDir?: string;
    targetSubdir?: string;
    promptFiles?: readonly string[];
    legacySubdirs?: readonly string[];
  },
): string[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const targetSubdir = options?.targetSubdir ?? MANAGED_SUBDIR;
  const promptFiles = options?.promptFiles ?? MANAGED_PROMPT_FILES;
  const legacySubdirs = options?.legacySubdirs ?? LEGACY_MANAGED_SUBDIRS;
  const promptsRoot = path.join(homeDir, ".pi", "agent", "prompts");
  const targetDir = path.join(promptsRoot, targetSubdir);

  for (const legacySubdir of legacySubdirs) {
    const legacyDir = path.join(promptsRoot, legacySubdir);
    if (legacyDir === targetDir || !existsSync(legacyDir)) {
      continue;
    }
    rmSync(legacyDir, { recursive: true, force: true });
  }

  mkdirSync(targetDir, { recursive: true });

  const written: string[] = [];
  for (const file of promptFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    const nextContent = readFileSync(sourcePath, "utf8");

    let currentContent: string | null = null;
    try {
      currentContent = readFileSync(targetPath, "utf8");
    } catch {
      currentContent = null;
    }

    if (currentContent === nextContent) {
      continue;
    }

    writeFileAtomicSync(targetPath, nextContent);
    written.push(targetPath);
  }

  return written;
}
