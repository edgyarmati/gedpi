import {
  type ExtensionAPI,
  isToolCallEventType,
} from "@mariozechner/pi-coding-agent";

import type {
  RepoMapDebugSnapshot,
  RepoMapRefreshResult,
  RepoMapRenderOptions,
  RepoMapSessionState,
} from "./repo-map-contracts.js";
import { refreshRepoMapState } from "./repo-map-index.js";
import { rankRepoMapEntries, renderRepoMapBlock } from "./repo-map-rank.js";
import { readRepoMapState } from "./repo-map-store.js";

const SESSION_RETENTION = 24;
const warmups = new Map<string, Promise<RepoMapRefreshResult>>();
const sessionState = new Map<string, RepoMapSessionState>();

function getSessionState(rootDir: string): RepoMapSessionState {
  let state = sessionState.get(rootDir);
  if (!state) {
    state = { signals: [], dirtyPaths: new Map<string, number>() };
    sessionState.set(rootDir, state);
  }
  return state;
}

function normalizePath(value: string): string {
  return value.replace(/^\.\//u, "").split("\\").join("/");
}

export function recordRepoMapSignal(
  rootDir: string,
  type: "read" | "edit" | "write" | "mention",
  filePath: string,
): void {
  const normalized = normalizePath(filePath);
  const state = getSessionState(rootDir);
  state.signals.unshift({ type, path: normalized, timestamp: Date.now() });
  state.signals = state.signals.slice(0, SESSION_RETENTION);
  if (type === "edit" || type === "write") {
    state.dirtyPaths.set(
      normalized,
      (state.dirtyPaths.get(normalized) ?? 0) + 1,
    );
  }
}

export function warmRepoMap(rootDir: string): Promise<RepoMapRefreshResult> {
  const existing = warmups.get(rootDir);
  if (existing) {
    return existing;
  }
  // Snapshot dirty paths up front. New edits arriving during the refresh
  // stay in the live Set so they kick off the next refresh — without the
  // snapshot, .finally().clear() would also drop those concurrent edits.
  const snapshot = new Map(getSessionState(rootDir).dirtyPaths);
  const task = refreshRepoMapState(rootDir, snapshot.keys()).finally(() => {
    const live = getSessionState(rootDir).dirtyPaths;
    for (const [dirty, generation] of snapshot) {
      if (live.get(dirty) === generation) {
        live.delete(dirty);
      }
    }
    warmups.delete(rootDir);
  });
  warmups.set(rootDir, task);
  return task;
}

export async function buildRepoMapPromptSuffix(
  rootDir: string,
  options: RepoMapRenderOptions = {},
): Promise<string> {
  const stateBefore = await readRepoMapState(rootDir);
  const refresh =
    Object.keys(stateBefore.files).length === 0 ||
    getSessionState(rootDir).dirtyPaths.size > 0
      ? await warmRepoMap(rootDir)
      : {
          state: stateBefore,
          indexedPaths: [],
          removedPaths: [],
          reusedPaths: [],
        };

  const prompt = options.prompt ?? "";
  const ranked = rankRepoMapEntries(
    refresh.state,
    getSessionState(rootDir),
    prompt,
  );
  const promptLength = prompt.length;
  const maxTokens =
    options.maxTokens ??
    (promptLength < 200 ? 260 : promptLength < 800 ? 200 : 140);
  return renderRepoMapBlock(ranked, maxTokens);
}

export async function getRepoMapDebugSnapshot(
  rootDir: string,
  options: RepoMapRenderOptions = {},
): Promise<RepoMapDebugSnapshot> {
  const state = (await warmRepoMap(rootDir)).state;
  const ranked = rankRepoMapEntries(
    state,
    getSessionState(rootDir),
    options.prompt ?? "",
  );
  const rendered = renderRepoMapBlock(ranked, options.maxTokens ?? 260);
  return { state, ranked, rendered };
}

export function registerRepoMapTracking(api: ExtensionAPI): void {
  api.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("read", event)) {
      recordRepoMapSignal(ctx.cwd, "read", event.input.path);
      return;
    }
    if (isToolCallEventType("edit", event)) {
      recordRepoMapSignal(ctx.cwd, "edit", event.input.path);
      return;
    }
    if (isToolCallEventType("write", event)) {
      recordRepoMapSignal(ctx.cwd, "write", event.input.path);
    }
  });
}
