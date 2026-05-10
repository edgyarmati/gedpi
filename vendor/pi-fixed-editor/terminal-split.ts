import { deleteAllKittyImages, isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

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

function setScrollRegion(top: number, bottom: number): string {
  return `\x1b[${top};${bottom}r`;
}

function resetScrollRegion(): string {
  return "\x1b[r";
}

function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function clearLine(): string {
  return "\x1b[2K";
}

function hideCursor(): string {
  return "\x1b[?25l";
}

function showCursor(): string {
  return "\x1b[?25h";
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

function descriptorForRows(terminal: TerminalLike): PropertyDescriptor | undefined {
  let target: object | null = terminal;
  while (target) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "rows");
    if (descriptor) return descriptor;
    target = Object.getPrototypeOf(target);
  }
  return undefined;
}

function readRows(terminal: TerminalLike, descriptor: PropertyDescriptor | undefined): number {
  if (descriptor?.get) {
    const value = descriptor.get.call(terminal);
    return typeof value === "number" && Number.isFinite(value) ? value : 24;
  }
  const value = Reflect.get(terminal, "rows");
  return typeof value === "number" && Number.isFinite(value) ? value : 24;
}

function buildFixedClusterPaint(
  cluster: { lines: string[] },
  terminalRows: number,
  width: number,
  showHardwareCursor: boolean,
): string {
  if (cluster.lines.length === 0) return "";

  const startRow = Math.max(1, terminalRows - cluster.lines.length + 1);
  let buffer = resetScrollRegion();

  for (let i = 0; i < cluster.lines.length; i++) {
    buffer += moveCursor(startRow + i, 1);
    buffer += clearLine();
    buffer += cluster.lines[i] ?? "";
  }

  if (showHardwareCursor) {
    buffer += showCursor();
  } else {
    buffer += hideCursor();
  }

  return buffer;
}

export class TerminalSplitCompositor {
  private readonly tui: any;
  private readonly terminal: TerminalLike;
  private readonly renderCluster: (width: number, terminalRows: number) => { lines: string[] };
  private readonly getShowHardwareCursor: () => boolean;
  private readonly mouseScroll: boolean;
  private readonly rowsDescriptor: PropertyDescriptor | undefined;
  private readonly originalWrite: (data: string) => void;
  private readonly originalDoRender: (() => void) | null;
  private readonly originalRender: ((width: number) => string[]) | null;
  private readonly patchedRenders: RenderPatch[] = [];
  private removeInputListener: (() => void) | null = null;
  private emergencyCleanup: (() => void) | null = null;
  private installed = false;
  private disposed = false;
  private writing = false;
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
    this.rowsDescriptor = descriptorForRows(options.terminal);
    this.originalWrite = options.terminal.write.bind(options.terminal);
    this.originalDoRender = typeof options.tui.doRender === "function" ? options.tui.doRender.bind(options.tui) : null;
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

    if (this.rowsDescriptor?.configurable !== false) {
      Object.defineProperty(this.terminal, "rows", {
        configurable: true,
        get: () => this.getScrollableRows(),
      });
    }

    if (this.originalRender) {
      this.tui.render = (width: number) => this.renderScrollableRoot(width);
    }

    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));
    }

    this.terminal.write = (data: string) => this.write(data);

    if (this.originalDoRender) {
      this.tui.doRender = () => {
        this.renderPassActive = true;
        try {
          this.originalDoRender?.();
          this.requestRepaint();
        } finally {
          this.renderPassActive = false;
        }
      };
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

    this.terminal.write = this.originalWrite;
    if (this.originalDoRender) {
      this.tui.doRender = this.originalDoRender;
    }
    if (this.originalRender) {
      this.tui.render = this.originalRender;
    }
    if (this.rowsDescriptor?.configurable !== false) {
      if (this.rowsDescriptor) {
        Object.defineProperty(this.terminal, "rows", this.rowsDescriptor);
      } else {
        Reflect.deleteProperty(this.terminal, "rows");
      }
    }

    this.originalWrite(
      beginSynchronizedOutput()
      + resetScrollRegion()
      + disableMouseReporting()
      + endSynchronizedOutput(),
    );
  }

  private getRawRows(): number {
    return Math.max(2, readRows(this.terminal, this.rowsDescriptor));
  }

  private getScrollableRows(): number {
    // CRITICAL: Never compute cluster height during a render operation.
    // Components may access terminal.rows during their render(), which would
    // trigger infinite recursion if we called renderCluster() here.
    if (this.disposed || this.writing || this.renderPassActive || this.renderingCluster || this.hasVisibleOverlay()) {
      return this.getRawRows();
    }
    const rawRows = this.getRawRows();
    return Math.max(1, rawRows - this.lastClusterHeight);
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

  private renderScrollableRoot(width: number): string[] {
    if (!this.originalRender || this.disposed) {
      return this.originalRender?.(width) ?? [];
    }

    if (this.hasVisibleOverlay()) {
      return this.originalRender(width);
    }

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
    return visibleLines;
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

  private requestRepaint(): void {
    if (this.disposed || this.hasVisibleOverlay()) return;
    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.withClusterRender(() => this.renderCluster(width, rawRows));
    this.lastClusterHeight = cluster.lines.length;
    if (cluster.lines.length === 0) return;

    this.originalWrite(
      beginSynchronizedOutput()
      + buildFixedClusterPaint(cluster, rawRows, width, this.getShowHardwareCursor())
      + endSynchronizedOutput(),
    );
  }

  private write(data: string): void {
    if (this.disposed || this.writing || this.hasVisibleOverlay()) {
      this.originalWrite(data);
      return;
    }

    this.writing = true;
    try {
      const rawRows = this.getRawRows();
      const width = Math.max(1, this.terminal.columns || 80);
      const cluster = this.withClusterRender(() => this.renderCluster(width, rawRows));
      this.lastClusterHeight = cluster.lines.length;
      const reservedRows = cluster.lines.length;

      if (reservedRows === 0 || rawRows <= 2) {
        this.originalWrite(data);
        return;
      }

      const scrollBottom = Math.max(1, rawRows - reservedRows);
      const hardwareCursorRow = typeof this.tui.hardwareCursorRow === "number"
        ? this.tui.hardwareCursorRow
        : typeof this.tui.cursorRow === "number"
          ? this.tui.cursorRow
          : 0;
      const viewportTop = typeof this.tui.previousViewportTop === "number" ? this.tui.previousViewportTop : 0;
      const screenRow = Math.max(1, Math.min(scrollBottom, hardwareCursorRow - viewportTop + 1));
      const imageCleanup = this.pendingImageCleanup ? deleteAllKittyImages() : "";
      this.pendingImageCleanup = false;

      const buffer = beginSynchronizedOutput()
        + imageCleanup
        + setScrollRegion(1, scrollBottom)
        + moveCursor(screenRow, 1)
        + data
        + buildFixedClusterPaint(cluster, rawRows, width, this.getShowHardwareCursor())
        + endSynchronizedOutput();

      this.originalWrite(buffer);
    } finally {
      this.writing = false;
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
