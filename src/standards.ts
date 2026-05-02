import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import { GED_DIR } from "./contracts.js";

export const GED_STANDARD_VERSION = 1;
const VERSION_PATH = path.join(GED_DIR, "VERSION");
const IMPORT_STATE_PATH = path.join(GED_DIR, "IMPORT-STATE.json");
const STANDARDS_PATH = path.join(GED_DIR, "STANDARDS.md");

interface ImportState {
  accepted: string[];
  rejected: string[];
  pending: string[];
}

export interface DiscoveredStandard {
  path: string;
  scope: "repo" | "scoped";
  kind: string;
  summary: string;
  hash: string;
}

export interface StandardsImportResult {
  discovered: DiscoveredStandard[];
  pending: DiscoveredStandard[];
  accepted: DiscoveredStandard[];
  rejected: DiscoveredStandard[];
  promptNeeded: boolean;
}

interface ConfirmUI {
  confirm(title: string, message: string): Promise<boolean>;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function summarize(content: string): string {
  const paragraph = content
    .split(/\n\s*\n/u)
    .map((part) =>
      part
        .replace(/^#+\s*/gmu, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .find(Boolean);
  if (!paragraph) {
    return "No summary available.";
  }
  return paragraph.length > 180 ? `${paragraph.slice(0, 180)}…` : paragraph;
}

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

async function readDiscoveredFile(
  rootDir: string,
  relativePath: string,
  scope: "repo" | "scoped",
  kind: string,
): Promise<DiscoveredStandard | null> {
  const absolutePath = path.join(rootDir, relativePath);
  const content = await readOptional(absolutePath);
  if (!content?.trim()) {
    return null;
  }
  return {
    path: relativePath,
    scope,
    kind,
    summary: summarize(content),
    hash: hashContent(content),
  };
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

async function discoverScopedFiles(
  rootDir: string,
  relativeDir: string,
  filter: (relativePath: string) => boolean,
  kind: string,
): Promise<DiscoveredStandard[]> {
  const absoluteDir = path.join(rootDir, relativeDir);
  if (!(await pathExists(absoluteDir))) {
    return [];
  }
  const files = await walkFiles(absoluteDir);
  const discovered = await Promise.all(
    files
      .map((absolutePath) => path.relative(rootDir, absolutePath))
      .filter(filter)
      .map((relativePath) =>
        readDiscoveredFile(rootDir, relativePath, "scoped", kind),
      ),
  );
  return discovered.filter(
    (value): value is DiscoveredStandard => value != null,
  );
}

export async function scanExternalStandards(
  rootDir: string,
): Promise<DiscoveredStandard[]> {
  const repoWideCandidates: Array<{ path: string; kind: string }> = [
    { path: "AGENTS.md", kind: "agents" },
    { path: "AGENTS.override.md", kind: "agents-override" },
    { path: "CLAUDE.md", kind: "claude" },
    { path: "GEMINI.md", kind: "gemini" },
    { path: ".github/copilot-instructions.md", kind: "copilot" },
    { path: ".cursorrules", kind: "cursor" },
  ];

  const repoWide = await Promise.all(
    repoWideCandidates.map((candidate) =>
      readDiscoveredFile(rootDir, candidate.path, "repo", candidate.kind),
    ),
  );

  const scoped = (
    await Promise.all([
      discoverScopedFiles(
        rootDir,
        ".github/instructions",
        (relativePath) => relativePath.endsWith(".instructions.md"),
        "copilot-scoped",
      ),
      discoverScopedFiles(
        rootDir,
        ".cursor/rules",
        (relativePath) => relativePath.endsWith(".mdc"),
        "cursor-scoped",
      ),
      discoverScopedFiles(rootDir, ".windsurf/rules", () => true, "windsurf"),
      discoverScopedFiles(rootDir, ".continue/rules", () => true, "continue"),
    ])
  ).flat();

  const seen = new Set<string>();
  return [...repoWide, ...scoped]
    .filter((value): value is DiscoveredStandard => value != null)
    .filter((entry) => {
      const key = `${entry.path}:${entry.hash}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

async function readImportState(rootDir: string): Promise<ImportState> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, IMPORT_STATE_PATH), "utf8"),
    ) as ImportState;
  } catch {
    return { accepted: [], rejected: [], pending: [] };
  }
}

async function writeImportState(
  rootDir: string,
  state: ImportState,
): Promise<void> {
  await mkdir(path.join(rootDir, GED_DIR), { recursive: true });
  await writeFileAtomic(
    path.join(rootDir, IMPORT_STATE_PATH),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

async function syncAcceptedStandards(
  rootDir: string,
  acceptedPaths: string[],
): Promise<void> {
  const sections = await Promise.all(
    acceptedPaths.map(async (relativePath) => {
      const content = await readOptional(path.join(rootDir, relativePath));
      if (!content?.trim()) {
        return null;
      }
      return `## ${relativePath}\n\n\`\`\`md\n${content.trim()}\n\`\`\`\n`;
    }),
  );

  const body = sections.filter(Boolean).join("\n");
  const next = `# Imported Standards

These standards were imported from other harness-specific instruction files and approved for Ged use.

${body || "No imported standards have been accepted yet.\n"}
`;
  await writeFileAtomic(path.join(rootDir, STANDARDS_PATH), next);
}

function buildConfirmationMessage(candidates: DiscoveredStandard[]): string {
  const lines = candidates
    .slice(0, 6)
    .map((candidate) => `- ${candidate.path}: ${candidate.summary}`);
  const extra =
    candidates.length > 6 ? `\n- +${candidates.length - 6} more files` : "";
  return `Ged found external instruction files that could be kept as durable Ged standards.\n\n${lines.join("\n")}${extra}\n\nImport the repo-wide standards into .ged/STANDARDS.md now?`;
}

export async function resolveImportedStandards(
  rootDir: string,
  ui?: ConfirmUI,
): Promise<StandardsImportResult> {
  const discovered = await scanExternalStandards(rootDir);
  const repoWide = discovered.filter((entry) => entry.scope === "repo");
  const state = await readImportState(rootDir);

  const known = new Set([...state.accepted, ...state.rejected]);
  const newlyPending = repoWide.filter((entry) => !known.has(entry.path));
  let accepted = repoWide.filter((entry) =>
    state.accepted.includes(entry.path),
  );
  let rejected = repoWide.filter((entry) =>
    state.rejected.includes(entry.path),
  );
  let pending = repoWide.filter((entry) => state.pending.includes(entry.path));

  if (newlyPending.length > 0) {
    pending = [...pending, ...newlyPending];
    state.pending = Array.from(
      new Set([...state.pending, ...newlyPending.map((entry) => entry.path)]),
    );
  }

  if (ui && pending.length > 0) {
    const confirmed = await ui.confirm(
      "Import external standards?",
      buildConfirmationMessage(pending),
    );
    if (confirmed) {
      state.accepted = Array.from(
        new Set([...state.accepted, ...pending.map((entry) => entry.path)]),
      );
      accepted = repoWide.filter((entry) =>
        state.accepted.includes(entry.path),
      );
    } else {
      state.rejected = Array.from(
        new Set([...state.rejected, ...pending.map((entry) => entry.path)]),
      );
      rejected = repoWide.filter((entry) =>
        state.rejected.includes(entry.path),
      );
    }
    state.pending = [];
    pending = [];
  }

  await writeImportState(rootDir, state);
  await syncAcceptedStandards(rootDir, state.accepted);

  return {
    discovered,
    pending,
    accepted,
    rejected,
    promptNeeded: pending.length > 0,
  };
}

export async function readGedVersion(rootDir: string): Promise<number | null> {
  const content = await readOptional(path.join(rootDir, VERSION_PATH));
  if (!content) {
    return null;
  }
  // Accept the integer version as the only file content (with optional
  // trailing newline / whitespace). Refuse files like "1abc", "1 2", or
  // "v1" so a corrupted or unrelated file can't be silently treated as
  // a valid Ged standard version.
  const trimmed = content.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function writeGedVersion(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, GED_DIR), { recursive: true });
  await writeFileAtomic(
    path.join(rootDir, VERSION_PATH),
    `${GED_STANDARD_VERSION}\n`,
  );
}

export async function ensureIgnoredInGitignore(
  rootDir: string,
  ignoredEntry: string,
): Promise<boolean> {
  if (!(await pathExists(path.join(rootDir, ".git")))) {
    return false;
  }

  const gitignorePath = path.join(rootDir, ".gitignore");
  const existing = (await readOptional(gitignorePath)) ?? "";
  const entries = existing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (entries.includes(ignoredEntry)) {
    return false;
  }

  const prefix = existing.trimEnd();
  const next =
    prefix.length > 0 ? `${prefix}\n${ignoredEntry}\n` : `${ignoredEntry}\n`;
  await writeFileAtomic(gitignorePath, next);
  return true;
}

export async function ensurePiIgnoredInGitignore(
  rootDir: string,
): Promise<boolean> {
  return ensureIgnoredInGitignore(rootDir, ".pi/");
}
