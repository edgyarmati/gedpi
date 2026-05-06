import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { GED_DIR } from "./contracts.js";

const execFileAsync = promisify(execFile);

export interface ActiveGedPaths {
  workId: string;
  workDir: string;
  runtimeDir: string;
  specPath: string;
  tasksPath: string;
  testsPath: string;
  notesPath: string;
  metaPath: string;
  statePath: string;
  sessionSummaryPath: string;
  checkpointsPath: string;
}

export function branchNameToWorkId(branch: string): string {
  const normalized = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/[-_.]{2,}/gu, "-")
    .replace(/^[-_.]+|[-_.]+$/gu, "");
  return normalized || "root";
}

export async function currentWorkId(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "branch", "--show-current"],
      { timeout: 2000 },
    );
    return branchNameToWorkId(stdout.trim());
  } catch {
    return "root";
  }
}

export async function activeGedPaths(rootDir: string): Promise<ActiveGedPaths> {
  return gedPathsForWorkId(rootDir, await currentWorkId(rootDir));
}

export function gedPathsForWorkId(
  rootDir: string,
  workId: string,
): ActiveGedPaths {
  const safeWorkId = branchNameToWorkId(workId);
  const workDir = path.join(rootDir, GED_DIR, "work", safeWorkId);
  const runtimeDir = path.join(rootDir, GED_DIR, "runtime", safeWorkId);
  return {
    workId: safeWorkId,
    workDir,
    runtimeDir,
    specPath: path.join(workDir, "SPEC.md"),
    tasksPath: path.join(workDir, "TASKS.md"),
    testsPath: path.join(workDir, "TESTS.md"),
    notesPath: path.join(workDir, "NOTES.md"),
    metaPath: path.join(workDir, "META.json"),
    statePath: path.join(runtimeDir, "STATE.md"),
    sessionSummaryPath: path.join(runtimeDir, "SESSION-SUMMARY.md"),
    checkpointsPath: path.join(runtimeDir, "checkpoints.json"),
  };
}

export function relativeGedPath(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).split(path.sep).join("/");
}
