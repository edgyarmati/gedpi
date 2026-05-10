import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { relative } from "node:path";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  BUILTIN_COMMAND_PALETTE_ITEMS,
  type CommandPaletteItem,
  CommandPaletteOverlay,
  type CommandPaletteResult,
  stripAnsi,
} from "./amp-command-palette.js";

const MIN_BODY_LINES = 2;
const GIT_CACHE_MS = 2000;
const STATUS_LEFT_INSET = 1;
const STATUS_RIGHT_INSET = 1;
const WORKING_FRAMES = ["~", "≈", "≋"];

type WorkingState = {
  active: boolean;
  message: string;
  frame: string;
};

type GitInfo = {
  branch: string | null;
  changedFiles: number;
  added: number;
  modified: number;
  removed: number;
};

type UsageCost = {
  total: number;
  hasCost: boolean;
  usingSubscription: boolean;
};

const EMPTY_GIT_INFO: GitInfo = {
  branch: null,
  changedFiles: 0,
  added: 0,
  modified: 0,
  removed: 0,
};

let gitCache: { cwd: string; at: number; info: GitInfo } | undefined;
let gitRefresh: { cwd: string; promise: Promise<void> } | undefined;
let requestGitRender: (() => void) | undefined;

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: 500,
      },
      (error, stdout) => {
        resolve(error ? "" : stdout.trim());
      },
    );
  });
}

function parseNumstat(
  numstat: string,
): Pick<GitInfo, "added" | "modified" | "removed"> {
  let added = 0;
  let removed = 0;

  for (const line of numstat.split("\n")) {
    const [a, r] = line.split("\t");
    const add = Number(a);
    const rem = Number(r);
    if (Number.isFinite(add)) added += add;
    if (Number.isFinite(rem)) removed += rem;
  }

  const modified = Math.min(added, removed);
  return { added: added - modified, modified, removed: removed - modified };
}

function refreshGitInfo(cwd: string): void {
  if (gitRefresh?.cwd === cwd) return;

  gitRefresh = {
    cwd,
    promise: (async () => {
      const [branch, porcelain, numstat] = await Promise.all([
        runGit(cwd, ["branch", "--show-current"]),
        runGit(cwd, ["status", "--short"]),
        runGit(cwd, ["diff", "--numstat"]),
      ]);
      const changedFiles = porcelain
        ? porcelain.split("\n").filter(Boolean).length
        : 0;
      gitCache = {
        cwd,
        at: Date.now(),
        info: {
          branch: branch || null,
          changedFiles,
          ...parseNumstat(numstat),
        },
      };
      requestGitRender?.();
    })().finally(() => {
      if (gitRefresh?.cwd === cwd) gitRefresh = undefined;
    }),
  };
}

function getGitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (gitCache?.cwd === cwd) {
    if (now - gitCache.at >= GIT_CACHE_MS) refreshGitInfo(cwd);
    return gitCache.info;
  }

  refreshGitInfo(cwd);
  return EMPTY_GIT_INFO;
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatCost(value: number): string {
  if (value === 0) return "$0.000";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId;

  const simplified = modelId
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");

  if (visibleWidth(simplified) <= maxWidth) return simplified;
  return truncateToWidth(simplified, maxWidth, "…");
}

function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

function isEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return (
    plain.includes("─") &&
    [...plain].every((char) => "─↑↓ 0123456789more".includes(char))
  );
}

function splitEditorRender(lines: string[]): {
  editorLines: string[];
  popupLines: string[];
} {
  const withoutTop = lines.slice(1);
  const bottomRuleIndex = withoutTop.findIndex(isEditorRule);

  if (bottomRuleIndex === -1) {
    return { editorLines: withoutTop, popupLines: [] };
  }

  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function getSessionCost(ctx: ExtensionContext): UsageCost {
  let total = 0;
  let hasCost = false;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;

    const cost = entry.message.usage?.cost?.total;
    if (typeof cost !== "number" || !Number.isFinite(cost)) continue;

    total += cost;
    if (cost > 0) hasCost = true;
  }

  const usingSubscription = ctx.model
    ? Boolean(
        (
          ctx.modelRegistry as {
            isUsingOAuth?: (
              model: NonNullable<ExtensionContext["model"]>,
            ) => boolean;
          }
        ).isUsingOAuth?.(ctx.model),
      )
    : false;

  return { total, hasCost, usingSubscription };
}

function hideBuiltInWorking(ctx: ExtensionContext): void {
  (
    ctx.ui as typeof ctx.ui & { setWorkingVisible?: (visible: boolean) => void }
  ).setWorkingVisible?.(false);
}

class AmpEditor extends CustomEditor {
  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    private readonly getCtx: () => ExtensionContext,
    private readonly getThinkingLevel: () => string,
    private readonly getWorkingState: () => WorkingState,
    private readonly openCommandPalette: (
      initialQuery: string | undefined,
      onSelect: (result: CommandPaletteResult) => void,
    ) => void,
  ) {
    super(tui, theme, keybindings, { paddingX: 1 });
  }

  private get ctx(): ExtensionContext {
    return this.getCtx();
  }

  handleInput(data: string): void {
    if (data === "/" && this.getText().trim() === "") {
      this.openCommandPalette(undefined, (result) => {
        if (result.action === "insert") {
          this.insertCommand(result.command);
        } else {
          this.submitCommand(result.command);
        }
      });
      return;
    }

    super.handleInput(data);
  }

  private insertCommand(command: string): void {
    this.setText(`/${command} `);
    this.tui.requestRender();
  }

  private submitCommand(command: string): void {
    this.setText(`/${command}`);
    const submitValue = (this as unknown as { submitValue?: () => void })
      .submitValue;
    if (submitValue) {
      submitValue.call(this);
      return;
    }

    this.onSubmit?.(`/${command}`);
  }

  render(width: number): string[] {
    if (width < 12) return super.render(width);

    const innerWidth = Math.max(1, width - 2);
    const base = super.render(innerWidth);
    const { editorLines, popupLines } = splitEditorRender(base);
    const body = [...editorLines];

    while (body.length < MIN_BODY_LINES) {
      body.push(" ".repeat(innerWidth));
    }

    const leftTop = this.getUsageLabel();
    const rightTop = this.getModelLabel(
      Math.max(8, Math.floor(innerWidth * 0.48)),
    );
    const cwdLabel = this.getCwdLabel();
    const workingLabel = this.getWorkingLabel();
    const gitChangesLabel = this.getGitChangesLabel();

    return [
      this.borderWithLabels(width, leftTop, rightTop),
      ...body.map((line) => this.wrapBody(line, innerWidth)),
      this.borderWithRightLabel(width, cwdLabel),
      ...this.statusRows(width, workingLabel, gitChangesLabel),
      ...this.wrapPopupBlock(popupLines, width),
    ];
  }

  private getUsageLabel(): string {
    const usage = this.ctx.getContextUsage();
    const pct =
      usage?.percent == null
        ? "?"
        : `${Math.max(0, Math.floor(usage.percent))}%`;
    const contextWindow =
      usage?.contextWindow ?? this.ctx.model?.contextWindow ?? null;
    const parts = [` ${pct} of ${formatCount(contextWindow)}`];

    const cost = getSessionCost(this.ctx);
    if (cost.hasCost || cost.usingSubscription) {
      parts.push(
        `${formatCost(cost.total)}${cost.usingSubscription ? " (sub)" : ""}`,
      );
    }

    return `${parts.join(" · ")} `;
  }

  private getModelLabel(maxWidth: number): string {
    const modelId = this.ctx.model?.id ?? "model unknown";
    const thinkingLevel = this.getThinkingLevel();
    const thinkingWidth = visibleWidth(thinkingLevel);
    const modelWidth = Math.max(1, maxWidth - thinkingWidth - 3);
    const model = this.fg("text", compactModelId(modelId, modelWidth));
    const thinking = this.fg(this.getThinkingColor(), thinkingLevel);
    return ` ${model} ${this.fg("dim", "·")} ${thinking} `;
  }

  private getThinkingColor(): ThemeColor {
    switch (this.getThinkingLevel()) {
      case "minimal":
        return "thinkingMinimal";
      case "low":
        return "thinkingLow";
      case "medium":
        return "thinkingMedium";
      case "high":
        return "thinkingHigh";
      case "xhigh":
        return "thinkingXhigh";
      case "off":
      default:
        return "thinkingOff";
    }
  }

  private getCwdLabel(): string {
    const git = getGitInfo(this.ctx.cwd);
    return ` ${compactPath(this.ctx.cwd)}${git.branch ? ` (${git.branch})` : ""} `;
  }

  private getWorkingLabel(): string {
    const working = this.getWorkingState();
    if (!working.active) return "";

    const cancelHint = `${this.fg("accent", "Esc")}${this.fg("muted", " to cancel")}`;
    return `${this.fg("accent", working.frame)} ${this.fg("text", working.message)}  ${cancelHint}`;
  }

  private getGitChangesLabel(): string {
    const git = getGitInfo(this.ctx.cwd);
    if (git.changedFiles === 0) return "";

    const fileLabel = this.fg(
      "muted",
      `${git.changedFiles} ${git.changedFiles === 1 ? "file" : "files"} changed`,
    );
    const added =
      git.added > 0 ? ` ${this.fg("toolDiffAdded", `+${git.added}`)}` : "";
    const modified =
      git.modified > 0 ? ` ${this.fg("warning", `~${git.modified}`)}` : "";
    const removed =
      git.removed > 0
        ? ` ${this.fg("toolDiffRemoved", `-${git.removed}`)}`
        : "";
    return `${fileLabel}${added}${modified}${removed}`;
  }

  private fg(color: ThemeColor, text: string): string {
    return this.ctx.ui.theme.fg(color, text);
  }

  private wrapBody(line: string, innerWidth: number): string {
    const clipped = truncateToWidth(line, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    const content = clipped ? this.fg("text", clipped) : clipped;
    return this.sideBorder() + content + padding + this.sideBorder();
  }

  private wrapPopupBlock(lines: string[], width: number): string[] {
    if (lines.length === 0) return [];

    return lines.map((line) => {
      const clipped = truncateToWidth(line, width, "");
      const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
      return clipped + padding;
    });
  }

  private statusRows(
    width: number,
    leftLabel: string,
    rightLabel: string,
  ): string[] {
    if (!leftLabel && !rightLabel) return [];

    const contentWidth = Math.max(
      1,
      width - STATUS_LEFT_INSET - STATUS_RIGHT_INSET,
    );
    const maxLeft = Math.max(0, Math.floor(contentWidth * 0.44));
    const maxRight = Math.max(0, contentWidth - maxLeft - 2);
    const left = truncateToWidth(leftLabel, maxLeft, "…");
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const gap = " ".repeat(
      Math.max(1, contentWidth - visibleWidth(left) - visibleWidth(right)),
    );
    const leftPadding = " ".repeat(
      Math.min(STATUS_LEFT_INSET, Math.max(0, width - contentWidth)),
    );
    const rightPadding = " ".repeat(
      Math.min(
        STATUS_RIGHT_INSET,
        Math.max(0, width - contentWidth - visibleWidth(leftPadding)),
      ),
    );
    return [`${leftPadding}${left}${gap}${right}${rightPadding}`];
  }

  private borderWithLabels(
    width: number,
    leftLabel: string,
    rightLabel: string,
  ): string {
    const innerWidth = Math.max(0, width - 2);
    const maxLeft = Math.max(0, Math.floor(innerWidth * 0.44));
    const maxRight = Math.max(0, innerWidth - maxLeft - 2);
    const left = this.fg("muted", truncateToWidth(leftLabel, maxLeft, "…"));
    const right = truncateToWidth(rightLabel, maxRight, "…");
    const used = visibleWidth(left) + visibleWidth(right);
    const fill = Math.max(0, innerWidth - used);
    return (
      this.borderColor("╭") +
      left +
      this.borderColor("─".repeat(fill)) +
      right +
      this.borderColor("╮")
    );
  }

  private sideBorder(): string {
    return this.borderColor("│");
  }

  private borderWithRightLabel(width: number, label: string): string {
    const innerWidth = Math.max(0, width - 2);
    const right = this.fg(
      "muted",
      truncateToWidth(label, Math.max(0, innerWidth - 2), "…"),
    );
    const fill = Math.max(0, innerWidth - visibleWidth(right));
    return (
      this.borderColor("╰") +
      this.borderColor("─".repeat(fill)) +
      right +
      this.borderColor("╯")
    );
  }
}

function getCommandPaletteItems(pi: ExtensionAPI): CommandPaletteItem[] {
  const items = [
    ...BUILTIN_COMMAND_PALETTE_ITEMS,
    ...pi.getCommands().map((command) => ({
      name: command.name,
      description: command.description,
      source: command.source,
    })),
  ];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export default function (pi: ExtensionAPI) {
  const activeToolExecutions = new Set<string>();
  let activeThinkingLevel = "off";
  let activeCtx: ExtensionContext | undefined;
  let activeTui: { requestRender(): void } | undefined;
  let commandPaletteOpen = false;
  let isWorking = false;
  let workingMessage = "Waiting for response...";
  let workingFrameIndex = 0;
  let workingTimer: ReturnType<typeof setInterval> | undefined;

  const requestRender = () => activeTui?.requestRender();
  requestGitRender = requestRender;

  const stopWorkingTimer = () => {
    if (!workingTimer) return;
    clearInterval(workingTimer);
    workingTimer = undefined;
  };

  const startWorkingTimer = () => {
    stopWorkingTimer();
    workingTimer = setInterval(() => {
      workingFrameIndex = (workingFrameIndex + 1) % WORKING_FRAMES.length;
      requestRender();
    }, 160);
  };

  const setWorkingMessage = (message: string, ctx?: ExtensionContext) => {
    workingMessage = message;
    ctx?.ui.setWorkingMessage(message);
    requestRender();
  };

  const openCommandPalette = (
    initialQuery = "",
    onSelect: (result: CommandPaletteResult) => void,
  ) => {
    const ctx = activeCtx;
    if (!ctx?.hasUI || commandPaletteOpen) return;

    commandPaletteOpen = true;
    void ctx.ui
      .custom<CommandPaletteResult | null>(
        (tui, theme, keybindings, done) =>
          new CommandPaletteOverlay(
            getCommandPaletteItems(pi),
            initialQuery,
            tui,
            theme,
            keybindings,
            done,
          ),
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "90%",
            minWidth: 42,
            maxHeight: "80%",
            margin: 1,
          },
        },
      )
      .then((result) => {
        commandPaletteOpen = false;
        if (!result) return;
        onSelect(result);
      })
      .catch(() => {
        commandPaletteOpen = false;
      });
  };

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    activeCtx = ctx;
    activeThinkingLevel = pi.getThinkingLevel();

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new AmpEditor(
        tui,
        theme,
        keybindings,
        () => activeCtx ?? ctx,
        () => activeThinkingLevel,
        () => ({
          active: isWorking,
          message: workingMessage,
          frame: WORKING_FRAMES[workingFrameIndex] ?? WORKING_FRAMES[0],
        }),
        openCommandPalette,
      );
    });

    hideBuiltInWorking(ctx);

    ctx.ui.setFooter(() => ({
      invalidate() {},
      render() {
        return [];
      },
    }));
  });

  pi.on("thinking_level_select", (event, ctx) => {
    activeThinkingLevel = event.level;
    if (ctx.hasUI) requestRender();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    activeThinkingLevel = pi.getThinkingLevel();
    activeToolExecutions.clear();
    isWorking = true;
    workingFrameIndex = 0;
    startWorkingTimer();
    if (!ctx.hasUI) return;
    hideBuiltInWorking(ctx);
    setWorkingMessage("Waiting for response...", ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    hideBuiltInWorking(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant") return;
    if (activeToolExecutions.size > 0) return;
    setWorkingMessage("Streaming response...", ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    activeToolExecutions.add(event.toolCallId);
    if (!ctx.hasUI) return;
    setWorkingMessage("Running tools...", ctx);
  });

  pi.on("tool_execution_update", (_event, ctx) => {
    if (!ctx.hasUI) return;
    setWorkingMessage("Running tools...", ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeToolExecutions.delete(event.toolCallId);
    if (!ctx.hasUI) return;
    if (activeToolExecutions.size === 0) {
      setWorkingMessage("Waiting for response...", ctx);
    }
  });

  pi.on("agent_end", (_event, _ctx) => {
    isWorking = false;
    activeToolExecutions.clear();
    stopWorkingTimer();
    requestRender();
  });

  pi.on("session_shutdown", () => {
    stopWorkingTimer();
    activeTui = undefined;
  });
}
