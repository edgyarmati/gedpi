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

function fitLine(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  let fittedLeft = left;
  let fittedRight = right;
  while (
    visibleWidth(fittedLeft) + visibleWidth(fittedRight) > width &&
    visibleWidth(fittedRight) > 0
  ) {
    fittedRight = truncateToWidth(
      fittedRight,
      Math.max(0, visibleWidth(fittedRight) - 1),
      "",
    );
  }
  while (
    visibleWidth(fittedLeft) + visibleWidth(fittedRight) > width &&
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
    width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return truncateToWidth(
    `${fittedLeft}${" ".repeat(gap)}${fittedRight}`,
    width,
  );
}

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

function formatModel(ctx: ExtensionContext): string {
  if (!ctx.model) return "no model";
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function formatContext(ctx: ExtensionContext): string | undefined {
  const usage = ctx.getContextUsage();
  if (!usage || usage.percent === null) return undefined;
  return `ctx ${Math.round(usage.percent)}%`;
}

function formatCost(ctx: ExtensionContext): string | undefined {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    const message = entry.message as AssistantMessage;
    cost += message.usage?.cost?.total ?? 0;
  }
  return cost > 0 ? `$${cost.toFixed(3)}` : undefined;
}

function formatFooterStatuses(
  statuses: ReadonlyMap<string, string>,
  theme: Theme,
): string[] {
  return [...statuses.entries()]
    .filter(([key, value]) => key !== "gedpi" && value.trim().length > 0)
    .map(([_key, value]) => theme.fg("muted", value));
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

class GhostlightEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly api: ExtensionAPI,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2) return lines;

    const theme = this.ctx.ui.theme;
    const topLeft = theme.fg("accent", " ✦ gedpi ");
    const topRight = theme.fg("muted", " ghostlight-ready ");
    const bottomLeft = theme.fg(
      "muted",
      ` ${this.api.getThinkingLevel()} · ${formatContext(this.ctx) ?? "ctx ?"} `,
    );
    const bottomRight = theme.fg(
      "dim",
      " .ged workflow · clarify → plan → implement → verify ",
    );
    const border = (text: string) => this.borderColor(text);

    lines[0] = fitBorder(topLeft, topRight, width, border);
    lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, border);
    return lines;
  }
}

function createFooter(
  api: ExtensionAPI,
  ctx: ExtensionContext,
  tui: TUI,
  theme: Theme,
  footerData: {
    getGitBranch(): string | null;
    getExtensionStatuses(): ReadonlyMap<string, string>;
    onBranchChange(callback: () => void): () => void;
  },
): Component & { dispose?(): void } {
  const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
  return {
    dispose: unsubscribe,
    invalidate() {},
    render(width: number): string[] {
      const context = formatContext(ctx);
      const cost = formatCost(ctx);
      const branch = footerData.getGitBranch();
      const leftParts = [
        theme.fg("accent", "✦ gedpi"),
        branch ? theme.fg("muted", branch) : theme.fg("dim", "no git"),
        theme.fg("muted", api.getThinkingLevel()),
        ...formatFooterStatuses(footerData.getExtensionStatuses(), theme),
      ];
      const rightParts = [
        theme.fg("dim", formatModel(ctx)),
        context ? theme.fg("dim", context) : undefined,
        cost ? theme.fg("dim", cost) : undefined,
      ].filter((value): value is string => Boolean(value));
      return [
        fitLine(
          leftParts.join(theme.fg("dim", " │ ")),
          rightParts.join(theme.fg("dim", " │ ")),
          width,
        ),
      ];
    },
  };
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
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new GhostlightEditor(tui, theme, keybindings, ctx, api),
    );
    ctx.ui.setFooter((tui, theme, footerData) =>
      createFooter(api, ctx, tui, theme, footerData),
    );
    ctx.ui.setWorkingIndicator(makeWorkingIndicator(ctx.ui.theme));
  });
}
