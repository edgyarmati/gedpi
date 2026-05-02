import path from "node:path";

import type {
  RepoMapRankedEntry,
  RepoMapSessionState,
  RepoMapState,
} from "./repo-map-contracts.js";

function normalize(scores: Record<string, number>): Record<string, number> {
  const values = Object.values(scores);
  const max = Math.max(...values, 0);
  if (max <= 0) {
    return Object.fromEntries(Object.keys(scores).map((key) => [key, 0]));
  }
  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, value / max]),
  );
}

function computePageRank(state: RepoMapState): Record<string, number> {
  const paths = Object.keys(state.files);
  const count = paths.length;
  if (count === 0) {
    return {};
  }

  let scores = Object.fromEntries(
    paths.map((filePath) => [filePath, 1 / count]),
  );
  const damping = 0.85;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const next = Object.fromEntries(
      paths.map((filePath) => [filePath, (1 - damping) / count]),
    );

    for (const filePath of paths) {
      const outgoing =
        state.files[filePath]?.outgoingPaths.filter(
          (target) => target in state.files,
        ) ?? [];
      if (outgoing.length === 0) {
        const share = (scores[filePath] ?? 0) / count;
        for (const target of paths) {
          next[target] += damping * share;
        }
        continue;
      }

      const share = (scores[filePath] ?? 0) / outgoing.length;
      for (const target of outgoing) {
        next[target] += damping * share;
      }
    }

    scores = next;
  }

  return normalize(scores);
}

function computeTurnScores(
  state: RepoMapState,
  session: RepoMapSessionState,
  prompt: string,
): Record<string, number> {
  const scores = Object.fromEntries(
    Object.keys(state.files).map((filePath) => [filePath, 0]),
  );
  const lowerPrompt = prompt.toLowerCase();
  const basenameCounts = new Map<string, number>();

  for (const filePath of Object.keys(state.files)) {
    const basename = path.basename(filePath).toLowerCase();
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const signal of session.signals) {
    if (!(signal.path in state.files)) continue;
    const weight =
      signal.type === "edit" || signal.type === "write"
        ? 1.0
        : signal.type === "read"
          ? 0.55
          : 0.4;
    scores[signal.path] += weight;
    for (const neighbor of state.files[signal.path]?.outgoingPaths ?? []) {
      if (neighbor in scores) scores[neighbor] += weight * 0.25;
    }
    for (const neighbor of state.files[signal.path]?.incomingPaths ?? []) {
      if (neighbor in scores) scores[neighbor] += weight * 0.15;
    }
  }

  for (const filePath of Object.keys(state.files)) {
    const basename = path.basename(filePath).toLowerCase();
    if (lowerPrompt.includes(filePath.toLowerCase())) {
      scores[filePath] += 0.7;
      continue;
    }
    if (
      (basenameCounts.get(basename) ?? 0) === 1 &&
      lowerPrompt.includes(basename)
    ) {
      scores[filePath] += 0.35;
    }
  }

  return normalize(scores);
}

export function rankRepoMapEntries(
  state: RepoMapState,
  session: RepoMapSessionState,
  prompt: string,
): RepoMapRankedEntry[] {
  const base = computePageRank(state);
  const turn = computeTurnScores(state, session, prompt);

  return Object.values(state.files)
    .map((file) => {
      const baseScore =
        (base[file.path] ?? 0) + file.incomingPaths.length * 0.08;
      const turnScore = turn[file.path] ?? 0;
      const finalScore =
        baseScore * 0.75 + turnScore * 1.1 + file.symbols.length * 0.03;
      const tags = new Set<string>();
      if (
        session.signals.some(
          (signal) => signal.path === file.path && signal.type === "edit",
        )
      ) {
        tags.add("recently-edited");
      }
      if (
        session.signals.some(
          (signal) => signal.path === file.path && signal.type === "write",
        )
      ) {
        tags.add("recently-written");
      }
      if (
        session.signals.some(
          (signal) => signal.path === file.path && signal.type === "read",
        )
      ) {
        tags.add("recently-read");
      }
      if (turnScore > 0.2 && prompt.length > 0) {
        tags.add("mentioned");
      }
      return {
        path: file.path,
        file,
        baseScore,
        turnScore,
        finalScore,
        blastRadius: file.incomingPaths.length,
        tags: [...tags],
      };
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        left.path.localeCompare(right.path),
    );
}

export function renderRepoMapBlock(
  ranked: RepoMapRankedEntry[],
  maxTokens: number,
): string {
  if (ranked.length === 0 || maxTokens <= 0) {
    return "";
  }

  const lines = ["## Repo Map"];
  let approxTokens = 3;

  for (const entry of ranked) {
    const headerTags =
      entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
    const header = `${entry.path} (→${entry.blastRadius})${headerTags}`;
    const symbols = entry.file.symbols
      .filter((symbol) => symbol.exported)
      .slice(0, 3)
      .map((symbol) => {
        const signature = symbol.signature ? ` ${symbol.signature}` : "";
        return `  +${symbol.name}${signature}`;
      });
    const chunk = [header, ...symbols].join("\n");
    const chunkTokens = Math.ceil(chunk.length / 4);
    if (approxTokens + chunkTokens > maxTokens) {
      break;
    }
    approxTokens += chunkTokens;
    lines.push(chunk);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}
