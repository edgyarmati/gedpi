import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  RepoMapFileRecord,
  RepoMapImport,
  RepoMapRefreshResult,
  RepoMapState,
  RepoMapSymbol,
} from "./repo-map-contracts.js";
import { REPO_MAP_SCHEMA_VERSION } from "./repo-map-contracts.js";
import { readRepoMapState, writeRepoMapState } from "./repo-map-store.js";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".pi",
  ".ged",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
]);

const SUPPORTED_EXTENSIONS = new Map<string, string>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".json", "json"],
]);

interface IgnoreRule {
  pattern: string;
  anchored: boolean;
  directoryOnly: boolean;
}

interface WalkContext {
  rootDir: string;
  relativeDir: string;
  rules: IgnoreRule[];
}

interface ParsedFile {
  language: string;
  parserStatus: RepoMapFileRecord["parserStatus"];
  symbols: RepoMapSymbol[];
  imports: RepoMapImport[];
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function hashContent(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function parseIgnoreRules(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("#") && !line.startsWith("!"),
    )
    .map((line) => {
      const directoryOnly = line.endsWith("/");
      const raw = directoryOnly ? line.slice(0, -1) : line;
      const anchored = raw.startsWith("/");
      return {
        pattern: raw.replace(/^\//u, ""),
        anchored,
        directoryOnly,
      };
    });
}

function matchSingleSegment(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function isIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  return rules.some((rule) => {
    if (rule.directoryOnly && !isDirectory) {
      return false;
    }
    if (rule.pattern.includes("/")) {
      // Both anchored and non-anchored rules match against the full
      // normalized path; anchoring is expressed in the regex / string
      // comparison shape below, not in the target.
      if (rule.pattern.includes("*")) {
        const escaped = rule.pattern
          .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
          .replace(/\*/gu, ".*");
        const regex = rule.anchored
          ? new RegExp(`^${escaped}(?:/.*)?$`, "u")
          : new RegExp(`(?:^|/)${escaped}(?:/.*)?$`, "u");
        return regex.test(normalized);
      }
      return rule.anchored
        ? normalized === rule.pattern ||
            normalized.startsWith(`${rule.pattern}/`)
        : normalized === rule.pattern ||
            normalized.includes(`/${rule.pattern}`) ||
            normalized.startsWith(`${rule.pattern}/`);
    }
    return segments.some((segment) =>
      matchSingleSegment(rule.pattern, segment),
    );
  });
}

async function loadIgnoreRules(dir: string): Promise<IgnoreRule[]> {
  try {
    const content = await readFile(path.join(dir, ".gitignore"), "utf8");
    return parseIgnoreRules(content);
  } catch {
    return [];
  }
}

async function walkEligibleFiles(context: WalkContext): Promise<string[]> {
  const absoluteDir = path.join(context.rootDir, context.relativeDir);
  const [entries, localRules] = await Promise.all([
    readdir(absoluteDir, { withFileTypes: true }),
    loadIgnoreRules(absoluteDir),
  ]);
  const rules = [...context.rules, ...localRules];
  const results: string[] = [];

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(
      path.join(context.relativeDir, entry.name),
    );

    if (DEFAULT_IGNORES.has(entry.name)) {
      continue;
    }
    if (isIgnored(relativePath, entry.isDirectory(), rules)) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(
        ...(await walkEligibleFiles({
          rootDir: context.rootDir,
          relativeDir: relativePath,
          rules,
        })),
      );
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      continue;
    }
    results.push(relativePath);
  }

  return results.sort();
}

export async function discoverRepoMapFiles(rootDir: string): Promise<string[]> {
  return walkEligibleFiles({ rootDir, relativeDir: "", rules: [] });
}

function detectLanguage(filePath: string): string {
  return (
    SUPPORTED_EXTENSIONS.get(path.extname(filePath).toLowerCase()) ?? "text"
  );
}

function resolveImportPath(
  rootDir: string,
  filePath: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const basedir = path.dirname(path.join(rootDir, filePath));
  const candidateBase = path.resolve(basedir, specifier);
  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.mts`,
    `${candidateBase}.cts`,
    `${candidateBase}.js`,
    `${candidateBase}.jsx`,
    `${candidateBase}.mjs`,
    `${candidateBase}.cjs`,
    path.join(candidateBase, "index.ts"),
    path.join(candidateBase, "index.tsx"),
    path.join(candidateBase, "index.js"),
    path.join(candidateBase, "index.jsx"),
  ];

  for (const candidate of candidates) {
    const relative = normalizeRelativePath(path.relative(rootDir, candidate));
    if (relative.startsWith("..")) {
      continue;
    }
    if (
      SUPPORTED_EXTENSIONS.has(path.extname(candidate).toLowerCase()) ||
      candidate.endsWith("/index.ts") ||
      candidate.endsWith("/index.tsx") ||
      candidate.endsWith("/index.js") ||
      candidate.endsWith("/index.jsx")
    ) {
      return relative;
    }
  }

  return undefined;
}

function uniqueSymbols(symbols: RepoMapSymbol[]): RepoMapSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}:${symbol.exported}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseModuleFile(
  rootDir: string,
  filePath: string,
  content: string,
): ParsedFile {
  if (content.includes("\u0000")) {
    return {
      language: detectLanguage(filePath),
      parserStatus: "binary-fallback",
      symbols: [],
      imports: [],
    };
  }

  const imports: RepoMapImport[] = [];
  // Use [^;]*? rather than [\s\S]*? so a missing `from` on one statement
  // can't lazily expand into the next one and merge two imports into a
  // single match. Multi-line imports are still allowed because they don't
  // contain semicolons until the terminating one.
  const importRegex =
    /^(?:import\s+[^;]*?\s+from\s+|export\s+[^;]*?\s+from\s+)["']([^"']+)["'];?/gmu;
  for (const match of content.matchAll(importRegex)) {
    const specifier = match[1]?.trim();
    if (!specifier) continue;
    imports.push({
      specifier,
      resolvedPath: resolveImportPath(rootDir, filePath, specifier),
    });
  }

  const symbols: RepoMapSymbol[] = [];
  const symbolPatterns: Array<{ regex: RegExp; kind: RepoMapSymbol["kind"] }> =
    [
      {
        regex:
          /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/gmu,
        kind: "function",
      },
      {
        regex: /^export\s+class\s+([A-Za-z_$][\w$]*)/gmu,
        kind: "class",
      },
      {
        regex: /^export\s+interface\s+([A-Za-z_$][\w$]*)/gmu,
        kind: "interface",
      },
      {
        regex: /^export\s+type\s+([A-Za-z_$][\w$]*)/gmu,
        kind: "type",
      },
      {
        regex: /^export\s+enum\s+([A-Za-z_$][\w$]*)/gmu,
        kind: "enum",
      },
      {
        regex: /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gmu,
        kind: "const",
      },
    ];

  for (const pattern of symbolPatterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const name = match[1]?.trim();
      if (!name) continue;
      const signature = match[2]?.trim();
      symbols.push({
        name,
        kind: pattern.kind,
        signature,
        exported: true,
      });
    }
  }

  if (/^export\s+default\b/gmu.test(content)) {
    symbols.push({
      name: path.basename(filePath, path.extname(filePath)),
      kind: "default",
      exported: true,
    });
  }

  return {
    language: detectLanguage(filePath),
    parserStatus: "indexed",
    symbols: uniqueSymbols(symbols),
    imports,
  };
}

export async function indexRepoMapFile(
  rootDir: string,
  filePath: string,
  previous?: RepoMapFileRecord,
): Promise<RepoMapFileRecord> {
  const absolutePath = path.join(rootDir, filePath);
  const [stats, content] = await Promise.all([
    stat(absolutePath),
    readFile(absolutePath, "utf8"),
  ]);
  const parsed = parseModuleFile(rootDir, filePath, content);
  const now = new Date().toISOString();

  return {
    path: filePath,
    language: parsed.language,
    parserStatus: parsed.parserStatus,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    fingerprint: { kind: "hash", value: hashContent(content) },
    indexedAt: now,
    firstIndexedAt: previous?.firstIndexedAt ?? now,
    symbols: parsed.symbols,
    imports: parsed.imports,
    outgoingPaths: parsed.imports
      .map((entry) => entry.resolvedPath)
      .filter((value): value is string => Boolean(value)),
    incomingPaths: previous?.incomingPaths ?? [],
  };
}

function rebuildIncomingPaths(files: Record<string, RepoMapFileRecord>): void {
  for (const file of Object.values(files)) {
    file.incomingPaths = [];
  }
  for (const file of Object.values(files)) {
    const uniqueOutgoing = [...new Set(file.outgoingPaths)].filter(
      (target) => target in files,
    );
    file.outgoingPaths = uniqueOutgoing;
    for (const target of uniqueOutgoing) {
      files[target]?.incomingPaths.push(file.path);
    }
  }
  for (const file of Object.values(files)) {
    file.incomingPaths = [...new Set(file.incomingPaths)].sort();
  }
}

const STAT_CONCURRENCY = 32;

async function statInPool(
  rootDir: string,
  filePaths: readonly string[],
): Promise<Map<string, { size: number; mtimeMs: number } | null>> {
  const results = new Map<string, { size: number; mtimeMs: number } | null>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < filePaths.length) {
      const index = cursor;
      cursor += 1;
      const filePath = filePaths[index];
      try {
        const stats = await stat(path.join(rootDir, filePath));
        results.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs });
      } catch {
        results.set(filePath, null);
      }
    }
  }

  const workerCount = Math.min(STAT_CONCURRENCY, filePaths.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function refreshRepoMapState(
  rootDir: string,
  dirtyPaths: Iterable<string> = [],
): Promise<RepoMapRefreshResult> {
  const previous = await readRepoMapState(rootDir);
  const discovered = await discoverRepoMapFiles(rootDir);
  const discoveredSet = new Set(discovered);
  const dirtySet = new Set([...dirtyPaths].map(normalizeRelativePath));
  const nextFiles: Record<string, RepoMapFileRecord> = {};
  const indexedPaths: string[] = [];
  const reusedPaths: string[] = [];
  const statResults = await statInPool(rootDir, discovered);

  for (const filePath of discovered) {
    const previousRecord = previous.files[filePath];
    let stats = statResults.get(filePath);
    if (!stats) {
      // File disappeared between discovery and stat — treat as removed.
      continue;
    }
    if (
      previousRecord &&
      previous.schemaVersion === REPO_MAP_SCHEMA_VERSION &&
      !dirtySet.has(filePath) &&
      previousRecord.mtimeMs === stats.mtimeMs &&
      previousRecord.size === stats.size
    ) {
      try {
        // The pooled stat pass is intentionally early for throughput. Re-stat
        // cache-hit candidates immediately before reuse so edits that land
        // during the pool window don't keep stale repo-map records alive.
        const freshStats = await stat(path.join(rootDir, filePath));
        stats = { size: freshStats.size, mtimeMs: freshStats.mtimeMs };
      } catch {
        continue;
      }
    }
    const unchanged =
      previousRecord &&
      previousRecord.mtimeMs === stats.mtimeMs &&
      previousRecord.size === stats.size &&
      !dirtySet.has(filePath) &&
      previous.schemaVersion === REPO_MAP_SCHEMA_VERSION;

    if (unchanged) {
      nextFiles[filePath] = {
        ...previousRecord,
        incomingPaths: [...previousRecord.incomingPaths],
        outgoingPaths: [...previousRecord.outgoingPaths],
        imports: [...previousRecord.imports],
        symbols: [...previousRecord.symbols],
      };
      reusedPaths.push(filePath);
      continue;
    }

    try {
      nextFiles[filePath] = await indexRepoMapFile(
        rootDir,
        filePath,
        previousRecord,
      );
      indexedPaths.push(filePath);
    } catch {
      nextFiles[filePath] = {
        path: filePath,
        language: detectLanguage(filePath),
        parserStatus: "parse-fallback",
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        fingerprint: {
          kind: "stat",
          value: `${stats.size}:${stats.mtimeMs}`,
        },
        indexedAt: new Date().toISOString(),
        firstIndexedAt:
          previousRecord?.firstIndexedAt ?? new Date().toISOString(),
        symbols: [],
        imports: [],
        outgoingPaths: [],
        incomingPaths: [],
      };
      indexedPaths.push(filePath);
    }
  }

  rebuildIncomingPaths(nextFiles);
  const removedPaths = Object.keys(previous.files).filter(
    (filePath) => !discoveredSet.has(filePath),
  );

  const state: RepoMapState = {
    schemaVersion: REPO_MAP_SCHEMA_VERSION,
    indexedAt: new Date().toISOString(),
    files: nextFiles,
  };
  await writeRepoMapState(rootDir, state);

  return {
    state,
    indexedPaths: indexedPaths.sort(),
    removedPaths: removedPaths.sort(),
    reusedPaths: reusedPaths.sort(),
  };
}
