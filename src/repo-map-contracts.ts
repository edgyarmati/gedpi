import path from "node:path";

export const REPO_MAP_DIR = path.join(".pi", "repo-map");
export const REPO_MAP_STATE_FILE = path.join(REPO_MAP_DIR, "state.json");
export const REPO_MAP_SCHEMA_VERSION = 2;

export type RepoMapParserStatus =
  | "indexed"
  | "unsupported"
  | "binary-fallback"
  | "parse-fallback";

export type RepoMapSignalType = "read" | "edit" | "write" | "mention";

export interface RepoMapSymbol {
  name: string;
  kind:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "enum"
    | "const"
    | "default"
    | "module";
  signature?: string;
  exported: boolean;
}

export interface RepoMapImport {
  specifier: string;
  resolvedPath?: string;
}

export type RepoMapFingerprint =
  | { kind: "hash"; value: string }
  | { kind: "stat"; value: string };

export interface RepoMapFileRecord {
  path: string;
  language: string;
  parserStatus: RepoMapParserStatus;
  size: number;
  mtimeMs: number;
  fingerprint: RepoMapFingerprint;
  indexedAt: string;
  firstIndexedAt: string;
  symbols: RepoMapSymbol[];
  imports: RepoMapImport[];
  outgoingPaths: string[];
  incomingPaths: string[];
}

export interface RepoMapState {
  schemaVersion: number;
  indexedAt: string;
  files: Record<string, RepoMapFileRecord>;
}

export interface RepoMapRankedEntry {
  path: string;
  file: RepoMapFileRecord;
  baseScore: number;
  turnScore: number;
  finalScore: number;
  blastRadius: number;
  tags: string[];
}

export interface RepoMapSignal {
  type: RepoMapSignalType;
  path: string;
  timestamp: number;
}

export interface RepoMapSessionState {
  signals: RepoMapSignal[];
  dirtyPaths: Map<string, number>;
}

export interface RepoMapRenderOptions {
  prompt?: string;
  maxTokens?: number;
}

export interface RepoMapRefreshResult {
  state: RepoMapState;
  indexedPaths: string[];
  removedPaths: string[];
  reusedPaths: string[];
}

export interface RepoMapDebugSnapshot {
  state: RepoMapState;
  ranked: RepoMapRankedEntry[];
  rendered: string;
}
