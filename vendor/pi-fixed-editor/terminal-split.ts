import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

export interface TerminalLike {
  columns: number;
  rows: number;
  kittyProtocolActive?: boolean;
  write(data: string): void;
}

interface TerminalSplitCompositorOptions {
  tui: any;
  terminal: TerminalLike;
  renderCluster: (width: number, terminalRows: number) => { lines: string[] };
  getShowHardwareCursor?: () => boolean;
  mouseScroll?: boolean;
}

interface PatchedRenderable {
  render(width: number): string[];
}

interface RenderPatch {
  target: PatchedRenderable;
  originalRender: (width: number) => string[];
}

function beginSynchronizedOutput(): string {
  return "\x1b[?2026h";
}

function endSynchronizedOutput(): string {
  return "\x1b[?2026l";
}

function resetScrollRegion(): string {
  return "\x1b[r";
}

function enableMouseReporting(): string {
  return "\x1b[?1002h\x1b[?1006h";
}

function disableMouseReporting(): string {
  return "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
}

function parseSgrMousePackets(data: string): Array<{ code: number; col: number; row: number; final: "M" | "m" }> | null {
  const pattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  const packets: Array<{ code: number; col: number; row: number; final: "M" | "m" }> = [];
  let offset = 0;

  for (const match of data.matchAll(pattern)) {
    if (match.index !== offset) return null;
    offset = match.index + match[0].length;
    packets.push({
      code: Number(match[1]),
      col: Number(match[2]),
      row: Number(match[3]),
      final: match[4] as "M" | "m",
    });
  }

  return packets.length > 0 && offset === data.length ? packets : null;
}

function mouseScrollDelta(packet: { code: number; final: "M" | "m" }): number {
  if (packet.final !== "M") return 0;
  const baseButton = packet.code & ~(4 | 8 | 16 | 32);
  if (baseButton === 64) return 3;
  if (baseButton === 65) return -3;
  return 0;
}

function parseKeyboardScrollDelta(data: string): number {
  if (isKeyRelease(data)) return 0;
  if (
    matchesKey(data, "pageUp")
    || matchesKey(data, "ctrl+shift+up")
    || /^\x1b\[(?:5;9(?::[12])?~|1;6(?::[12])?A|57421;9(?::[12])?u|57419;6(?::[12])?u)$/.test(data)
  ) return 10;
  if (
    matchesKey(data, "pageDown")
    || matchesKey(data, "ctrl+shift+down")
    || /^\x1b\[(?:6;9(?::[12])?~|1;6(?::[12])?B|57422;9(?::[12])?u|57420;6(?::[12])?u)$/.test(data)
  ) return -10;
  return 0;
}

function readRows(terminal: TerminalLike): number {
  const value = Reflect.get(terminal, "rows");
  return typeof value === "number" && Number.isFinite(value) ? value : 24;
}

export class TerminalSplitCompositor {
  private readonly tui: any;
  private readonly terminal: TerminalLike;
  private readonly renderCluster: (width: number, terminalRows: number) => { lines: string[] };
  private readonly getShowHardwareCursor: () => boolean;
  private readonly mouseScroll: boolean;
  private readonly originalWrite: (data: string) => void;
  private readonly originalRender: ((width: number) => string[]) | null;
  private readonly patchedRenders: RenderPatch[] = [];
  private removeInputListener: (() => void) | null = null;
  private emergencyCleanup: (() => void) | null = null;
  private installed = false;
  private disposed = false;
  private renderPassActive = false;
  private renderingCluster = false;
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private lastRootLineCount = 0;
  private rootLines: string[] = [];
  private visibleScrollableRows = 0;
  private checkingOverlay = false;
  private pendingImageCleanup = false;
  private lastClusterHeight = 0;

  constructor(options: TerminalSplitCompositorOptions) {
    this.tui = options.tui;
    this.terminal = options.terminal;
    this.renderCluster = options.renderCluster;
    this.getShowHardwareCursor = options.getShowHardwareCursor ?? (() => false);
    this.mouseScroll = options.mouseScroll !== false;
    this.originalWrite = options.terminal.write.bind(options.terminal);
    this.originalRender = typeof options.tui.render === "function" ? options.tui.render.bind(options.tui) : null;
  }

  install(): void {
    if (this.installed) return;
    if (typeof this.terminal.write !== "function") {
      throw new Error("[fixed-editor] Expected terminal.write(data) to exist");
    }

    this.originalWrite(
      beginSynchronizedOutput()
      + (this.mouseScroll ? enableMouseReporting() : "")
      + endSynchronizedOutput(),
    );

    this.emergencyCleanup = () => {
      if (!this.disposed) {
        try {
          this.originalWrite(
            beginSynchronizedOutput()
            + resetScrollRegion()
            + disableMouseReporting()
            + endSynchronizedOutput(),
          );
        } catch {
          // ignore
        }
      }
    };
    process.once("exit", this.emergencyCleanup);

    if (this.originalRender) {
      this.tui.render = (width: number) => this.renderFixedRoot(width);
    }

    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));
    }

    this.installed = true;
  }

  hideRenderable(target: PatchedRenderable): void {
    if (this.patchedRenders.some((patch) => patch.target === target)) return;
    const originalRender = target.render.bind(target);
    this.patchedRenders.push({ target, originalRender });
    target.render = () => [];
  }

  renderHidden(target: PatchedRenderable, width: number): string[] {
    const patch = this.patchedRenders.find((candidate) => candidate.target === target);
    const render = patch?.originalRender ?? target.render.bind(target);
    return render(width);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const patch of this.patchedRenders.splice(0)) {
      patch.target.render = patch.originalRender;
    }

    this.removeInputListener?.();
    this.removeInputListener = null;
    if (this.emergencyCleanup) {
      process.removeListener("exit", this.emergencyCleanup);
      this.emergencyCleanup = null;
    }

    if (this.originalRender) {
      this.tui.render = this.originalRender;
    }

    this.originalWrite(
      beginSynchronizedOutput()
      + resetScrollRegion()
      + disableMouseReporting()
      + endSynchronizedOutput(),
    );
  }

  private getRawRows(): number {
    return Math.max(2, readRows(this.terminal));
  }

  private withClusterRender<T>(render: () => T): T {
    const wasRenderingCluster = this.renderingCluster;
    this.renderingCluster = true;
    try {
      return render();
    } finally {
      this.renderingCluster = wasRenderingCluster;
    }
  }

  private renderFixedRoot(width: number): string[] {
    if (!this.originalRender || this.disposed) {
      return this.originalRender?.(width) ?? [];
    }

    if (this.hasVisibleOverlay()) {
      return this.originalRender(width);
    }

    this.renderPassActive = true;
    try {
      const rawRows = this.getRawRows();
      const renderWidth = Math.max(1, width);
      const cluster = this.withClusterRender(() => this.renderCluster(renderWidth, rawRows));
      this.lastClusterHeight = cluster.lines.length;
      const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
      const lines = this.originalRender(renderWidth);
      this.rootLines = lines;

      if (this.scrollOffset > 0 && this.lastRootLineCount > 0 && lines.length > this.lastRootLineCount) {
        this.scrollOffset += lines.length - this.lastRootLineCount;
      }
      this.lastRootLineCount = lines.length;

      const prevMaxScroll = this.maxScrollOffset;
      this.maxScrollOffset = Math.max(0, lines.length - scrollableRows);
      const clampedOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));
      if (clampedOffset !== this.scrollOffset || this.maxScrollOffset !== prevMaxScroll) {
        this.pendingImageCleanup = true;
      }
      this.scrollOffset = clampedOffset;

      const start = Math.max(0, this.rootLines.length - scrollableRows - this.scrollOffset);
      const visibleLines = this.rootLines.slice(start, start + scrollableRows);
      while (visibleLines.length < scrollableRows) {
        visibleLines.push("");
      }

      this.visibleScrollableRows = scrollableRows;
      return [...visibleLines, ...cluster.lines];
    } finally {
      this.renderPassActive = false;
    }
  }

  private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (this.disposed || this.hasVisibleOverlay()) return undefined;

    const mousePackets = this.mouseScroll ? parseSgrMousePackets(data) : null;
    if (mousePackets) {
      for (const packet of mousePackets) {
        const delta = mouseScrollDelta(packet);
        if (delta !== 0) {
          this.scrollBy(delta);
        }
      }
      return { consume: true };
    }

    const keyboardDelta = parseKeyboardScrollDelta(data);
    if (keyboardDelta === 0) return undefined;

    this.scrollBy(keyboardDelta);
    return { consume: true };
  }

  private scrollBy(delta: number): void {
    const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
    if (nextOffset === this.scrollOffset) return;

    this.scrollOffset = nextOffset;
    this.pendingImageCleanup = true;
    this.requestRender();
  }

  private requestRender(): void {
    if (typeof this.tui.requestRender === "function") {
      this.tui.requestRender();
    }
  }

  private hasVisibleOverlay(): boolean {
    if (this.checkingOverlay) return false;
    this.checkingOverlay = true;
    try {
      if (typeof this.tui.hasOverlay === "function" && this.tui.hasOverlay()) {
        return true;
      }
      const overlayStack = Reflect.get(this.tui, "overlayStack");
      if (!Array.isArray(overlayStack)) return false;
      return overlayStack.some((entry) => entry && entry.hidden !== true);
    } finally {
      this.checkingOverlay = false;
    }
  }
}

export function emergencyTerminalModeReset(): string {
  return beginSynchronizedOutput()
    + resetScrollRegion()
    + disableMouseReporting()
    + endSynchronizedOutput();
}
