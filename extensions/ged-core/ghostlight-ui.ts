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
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    const message = entry.message as AssistantMessage;
    cost += message.usage?.cost?.total ?? 0;
  }
  return `$${cost.toFixed(3)}`;
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

class GhostlightEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly api: ExtensionAPI,
    private readonly getBranch: () => string | undefined,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;

    const theme = this.ctx.ui.theme;
    const branch = this.getBranch();
    const topLeft = theme.fg("accent", " ✦ gedpi ");
    const topRight = branch ? theme.fg("muted", ` ${branch} `) : "";
    const bottomLeft = theme.fg(
      "muted",
      ` ${this.api.getThinkingLevel()} · ${formatContext(this.ctx)} · ${formatCost(this.ctx)} `,
    );
    const border = (text: string) => this.borderColor(text);

    lines[0] = fitBorder(topLeft, topRight, width, border);
    lines[lines.length - 1] = fitBorder(bottomLeft, "", width, border);
    return lines;
  }
}

export function registerGhostlightUi(api: ExtensionAPI): void {
  api.on("session_start", (_event, ctx) => {
    if (
      typeof ctx.ui.setEditorComponent !== "function" ||
      typeof ctx.ui.setFooter !== "function" ||
      typeof ctx.ui.setWorkingIndicator !== "function"
    ) {
      return;
    }

    let branch: string | undefined;
    let activeTui: TUI | undefined;
    void api
      .exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
      .then((result) => {
        const detected = result.stdout.trim();
        branch = detected.length > 0 ? detected : undefined;
        activeTui?.requestRender();
      })
      .catch(() => {
        branch = undefined;
      });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new GhostlightEditor(
        tui,
        theme,
        keybindings,
        ctx,
        api,
        () => branch,
      );
    });
    ctx.ui.setFooter(() => new EmptyFooter());
    ctx.ui.setWorkingIndicator(makeWorkingIndicator(ctx.ui.theme));
  });
}
