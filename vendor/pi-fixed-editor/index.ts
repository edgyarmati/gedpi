import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TerminalSplitCompositor, emergencyTerminalModeReset } from "./terminal-split.ts";
import { renderFixedEditorCluster } from "./cluster.ts";

let compositor: TerminalSplitCompositor | null = null;
let capturedEditor: any = null;
let capturedTui: any = null;
let disposed = false;

function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const index = children.findIndex(
    (candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child),
  );
  if (index === -1) return null;
  return { container: children[index], index };
}

function installCompositor(ctx: ExtensionContext): void {
  if (disposed || !capturedTui || !capturedEditor) return;

  const tui = capturedTui;
  if (!tui?.terminal || typeof tui.terminal.write !== "function") {
    console.warn("[fixed-editor] TUI terminal not available");
    return;
  }

  const editorContainerMatch = findContainerWithChild(tui, capturedEditor);
  if (!editorContainerMatch) {
    console.warn("[fixed-editor] Could not find editor container in TUI children");
    return;
  }

  const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
  const editorContainer = editorContainerMatch.container;
  const statusContainer = tuiChildren[editorContainerMatch.index - 2] ?? null;
  const widgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
  const widgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;
  const footerContainer = tuiChildren[editorContainerMatch.index + 2] ?? null;

  // Validate expected layout shape to avoid hiding wrong components.
  const editorIndex = editorContainerMatch.index;
  const hasExpectedLayout =
    editorIndex >= 2
    && editorIndex + 2 < tuiChildren.length
    && Array.isArray(editorContainer?.children);

  if (!hasExpectedLayout) {
    console.warn("[fixed-editor] TUI layout does not match expected shape; skipping install");
    return;
  }

  const comp = new TerminalSplitCompositor({
    tui,
    terminal: tui.terminal,
    mouseScroll: true,
    getShowHardwareCursor: () =>
      typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
    renderCluster: (width, terminalRows) => {
      const statusLines = statusContainer && typeof statusContainer.render === "function"
        ? comp.renderHidden(statusContainer, width).filter((line: string) => line.trim().length > 0)
        : [];
      const aboveLines = widgetContainerAbove && typeof widgetContainerAbove.render === "function"
        ? comp.renderHidden(widgetContainerAbove, width)
        : [];
      const belowLines = widgetContainerBelow && typeof widgetContainerBelow.render === "function"
        ? comp.renderHidden(widgetContainerBelow, width)
        : [];
      const footerLines = footerContainer && typeof footerContainer.render === "function"
        ? comp.renderHidden(footerContainer, width)
        : [];
      const editorLines = comp.renderHidden(editorContainer, width);

      return renderFixedEditorCluster({
        width,
        terminalRows,
        editorLines,
        footerLines: [...statusLines, ...footerLines],
        widgetAboveLines: aboveLines,
        widgetBelowLines: belowLines,
      });
    },
  });

  try {
    comp.install();
  } catch (error) {
    console.warn("[fixed-editor] Compositor install failed:", error instanceof Error ? error.message : String(error));
    comp.dispose();
    return;
  }

  compositor = comp;
  if (statusContainer?.render) comp.hideRenderable(statusContainer);
  if (widgetContainerAbove?.render) comp.hideRenderable(widgetContainerAbove);
  comp.hideRenderable(editorContainer);
  if (widgetContainerBelow?.render) comp.hideRenderable(widgetContainerBelow);
  if (footerContainer?.render) comp.hideRenderable(footerContainer);

  tui.requestRender(true);
}

function teardownCompositor(options?: { resetExtendedKeyboardModes?: boolean }): void {
  const hadCompositor = compositor !== null;
  compositor?.dispose();
  compositor = null;
  capturedEditor = null;
  capturedTui = null;

  if (!hadCompositor && options?.resetExtendedKeyboardModes) {
    try {
      process.stdout.write(emergencyTerminalModeReset());
    } catch {
      // ignore
    }
  }
}

export default function fixedEditorExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    disposed = false;

    const existingFactory = ctx.ui.getEditorComponent();
    if (!existingFactory) {
      // No custom editor — nothing to fix in place.
      return;
    }

    // Wrap the existing editor factory to capture TUI and editor instance.
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = existingFactory(tui, theme, keybindings);
      capturedEditor = editor;
      capturedTui = tui;

      // Defer install so all extensions have finished their session_start setup.
      setTimeout(() => {
        if (disposed) return;
        try {
          installCompositor(ctx);
        } catch (error) {
          console.warn("[fixed-editor] Install failed:", error instanceof Error ? error.message : String(error));
          teardownCompositor({ resetExtendedKeyboardModes: true });
        }
      }, 0);

      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    disposed = true;
    teardownCompositor({ resetExtendedKeyboardModes: true });
  });
}
