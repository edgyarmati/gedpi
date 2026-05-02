import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";
import {
  REPO_MAP_SCHEMA_VERSION,
  REPO_MAP_STATE_FILE,
  type RepoMapState,
} from "./repo-map-contracts.js";

function emptyState(): RepoMapState {
  return {
    schemaVersion: REPO_MAP_SCHEMA_VERSION,
    indexedAt: new Date(0).toISOString(),
    files: {},
  };
}

export function repoMapStatePath(rootDir: string): string {
  return path.join(rootDir, REPO_MAP_STATE_FILE);
}

export async function readRepoMapState(rootDir: string): Promise<RepoMapState> {
  try {
    const content = await readFile(repoMapStatePath(rootDir), "utf8");
    const parsed = JSON.parse(content) as RepoMapState;
    if (parsed.schemaVersion !== REPO_MAP_SCHEMA_VERSION) {
      return emptyState();
    }
    return {
      schemaVersion: REPO_MAP_SCHEMA_VERSION,
      indexedAt: parsed.indexedAt ?? new Date(0).toISOString(),
      files: parsed.files ?? {},
    };
  } catch {
    return emptyState();
  }
}

export async function writeRepoMapState(
  rootDir: string,
  state: RepoMapState,
): Promise<void> {
  const filePath = repoMapStatePath(rootDir);
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}
