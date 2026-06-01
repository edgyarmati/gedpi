import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ExecResult = { stdout: string };
type DiffSummary = {
  paths: Set<string>;
  added: number;
  deleted: number;
};

function fitBorder(
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");

  let fittedLeft = left;
  let fittedRight = right;
  const fixedWidth = 2;
  const minimumGap = 2;
  while (
    fixedWidth +
      visibleWidth(fittedLeft) +
      visibleWidth(fittedRight) +
      minimumGap >
      width &&
    visibleWidth(fittedRight) > 0
  ) {
    fittedRight = truncateToWidth(
      fittedRight,
      Math.max(0, visibleWidth(fittedRight) - 1),
      "",
    );
  }
  while (
    fixedWidth +
      visibleWidth(fittedLeft) +
      visibleWidth(fittedRight) +
      minimumGap >
      width &&
    visibleWidth(fittedLeft) > 0
  ) {
    fittedLeft = truncateToWidth(
      fittedLeft,
      Math.max(0, visibleWidth(fittedLeft) - 1),
      "",
    );
  }
  const gap = Math.max(
    0,
    width - fixedWidth - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return `${border("─")}${fittedLeft}${border("─".repeat(gap))}${fittedRight}${border("─")}`;
}

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (!usage || usage.percent === null) return "ctx ?";
  return `ctx ${Math.round(usage.percent)}%`;
}

function formatCost(ctx: ExtensionContext): string {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const message = entry.message as AssistantMessage;
    cost += message.usage?.cost?.total ?? 0;
  }
  return `$${cost.toFixed(3)}`;
}

function emptyDiffSummary(): DiffSummary {
  return { paths: new Set<string>(), added: 0, deleted: 0 };
}

function parseNumstat(output: string): DiffSummary {
  const summary = emptyDiffSummary();
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) continue;
    const [added, deleted, filePath] = line.split("\t");
    if (!filePath) continue;
    summary.paths.add(filePath);
    summary.added += Number(added) || 0;
    summary.deleted += Number(deleted) || 0;
  }
  return summary;
}

function combineDiffSummaries(
  summaries: DiffSummary[],
): DiffSummary | undefined {
  const combined = emptyDiffSummary();
  for (const item of summaries) {
    for (const filePath of item.paths) combined.paths.add(filePath);
    combined.added += item.added;
    combined.deleted += item.deleted;
  }
  return combined.paths.size > 0 ? combined : undefined;
}

function countTextLines(content: string): number {
  if (content.length === 0) return 0;
  const newlineCount = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

async function parseUntrackedSummary(
  cwd: string,
  output: string,
): Promise<DiffSummary> {
  const summary = emptyDiffSummary();
  const files = output.split("\0").filter(Boolean);
  await Promise.all(
    files.map(async (filePath) => {
      summary.paths.add(filePath);
      try {
        const content = await readFile(path.resolve(cwd, filePath), "utf8");
        summary.added += countTextLines(content);
      } catch {
        // Binary or unreadable untracked files still count as touched files.
      }
    }),
  );
  return summary;
}

function formatDiffSummary(
  summary: DiffSummary | undefined,
): string | undefined {
  if (!summary) return undefined;
  const fileCount = summary.paths.size;
  const fileLabel = fileCount === 1 ? "file" : "files";
  return `${fileCount} ${fileLabel} +${summary.added} -${summary.deleted}`;
}

function makeWorkingIndicator(theme: Theme): {
  frames: string[];
  intervalMs: number;
} {
  return {
    frames: [
      theme.fg("dim", "·"),
      theme.fg("muted", "•"),
      theme.fg("accent", "✦"),
      theme.fg("muted", "•"),
    ],
    intervalMs: 140,
  };
}

class EmptyFooter implements Component {
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}

class GedShellEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly api: ExtensionAPI,
    private readonly getBranch: () => string | undefined,
    private readonly getDiffSummary: () => string | undefined,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;

    const theme = this.ctx.ui.theme;
    const branch = this.getBranch();
    const diffSummary = this.getDiffSummary();
    const bottomRightParts = [branch, diffSummary].filter(
      (value): value is string => Boolean(value),
    );
    const topLeft = theme.fg("accent", " ✦ gedpi ");
    const topRight = theme.fg("muted", ` ${this.api.getThinkingLevel()} `);
    const bottomLeft = theme.fg(
      "dim",
      ` ${formatContext(this.ctx)} · ${formatCost(this.ctx)} `,
    );
    const bottomRight =
      bottomRightParts.length > 0
        ? theme.fg("muted", ` ${bottomRightParts.join(" · ")} `)
        : "";
    const border = (text: string) => this.borderColor(text);

    lines[0] = fitBorder(topLeft, topRight, width, border);
    lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, border);
    return lines;
  }
}

export function registerGhostlightUi(api: ExtensionAPI): void {
  api.on("session_start", (_event, ctx) => {
    if (
      typeof ctx.ui.setEditorComponent !== "function" ||
      typeof ctx.ui.setFooter !== "function" ||
      typeof ctx.ui.setWorkingIndicator !== "function"
    )
      return;

    let branch: string | undefined;
    let diffSummary: string | undefined;
    let activeTui: TUI | undefined;
    let refreshSerial = 0;

    const refreshGitStatus = async () => {
      const serial = ++refreshSerial;
      const [branchResult, trackedResult, untrackedResult] = await Promise.all([
        api
          .exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
          .catch(() => undefined),
        api
          .exec("git", ["diff", "HEAD", "--numstat"], { cwd: ctx.cwd })
          .catch(() => undefined),
        api
          .exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
            cwd: ctx.cwd,
          })
          .catch(() => undefined),
      ] as Promise<ExecResult | undefined>[]);
      if (serial !== refreshSerial) return;
      const detected = branchResult?.stdout.trim() ?? "";
      branch = detected.length > 0 ? detected : undefined;
      diffSummary = formatDiffSummary(
        combineDiffSummaries([
          parseNumstat(trackedResult?.stdout ?? ""),
          await parseUntrackedSummary(ctx.cwd, untrackedResult?.stdout ?? ""),
        ]),
      );
      activeTui?.requestRender();
    };

    void refreshGitStatus();

    api.on("tool_execution_end", (event) => {
      if (["edit", "write", "bash"].includes(event.toolName))
        void refreshGitStatus();
    });
    api.on("agent_end", () => {
      void refreshGitStatus();
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new GedShellEditor(
        tui,
        theme,
        keybindings,
        ctx,
        api,
        () => branch,
        () => diffSummary,
      );
    });
    ctx.ui.setFooter(() => new EmptyFooter());
    ctx.ui.setWorkingIndicator(makeWorkingIndicator(ctx.ui.theme));
  });
}
