import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  fuzzyFilter,
  Key,
  type KeybindingsManager,
  matchesKey,
  parseKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const MIN_WIDTH = 40;
const MAX_ROWS = 14;
const SIDE_PADDING = 1;
const TITLE = " Command Palette ";
const HELP_HINT =
  " type filter · ↑↓ navigate · tab insert · enter run/insert · esc close ";

export interface CommandPaletteItem {
  name: string;
  description?: string;
  source?: string;
}

export interface CommandPaletteResult {
  command: string;
  action: "insert" | "submit";
}

export const BUILTIN_COMMAND_PALETTE_ITEMS: CommandPaletteItem[] = [
  { name: "settings", description: "Open settings menu", source: "builtin" },
  { name: "model", description: "Select model", source: "builtin" },
  {
    name: "scoped-models",
    description: "Enable/disable Ctrl+P model cycling",
    source: "builtin",
  },
  { name: "export", description: "Export session", source: "builtin" },
  {
    name: "import",
    description: "Import and resume a session",
    source: "builtin",
  },
  {
    name: "share",
    description: "Share session as a secret GitHub gist",
    source: "builtin",
  },
  {
    name: "copy",
    description: "Copy last agent message to clipboard",
    source: "builtin",
  },
  { name: "name", description: "Set session display name", source: "builtin" },
  {
    name: "session",
    description: "Show session info and stats",
    source: "builtin",
  },
  {
    name: "changelog",
    description: "Show changelog entries",
    source: "builtin",
  },
  {
    name: "hotkeys",
    description: "Show all keyboard shortcuts",
    source: "builtin",
  },
  { name: "fork", description: "Create a new fork", source: "builtin" },
  {
    name: "clone",
    description: "Duplicate current session",
    source: "builtin",
  },
  { name: "tree", description: "Navigate session tree", source: "builtin" },
  {
    name: "login",
    description: "Configure provider authentication",
    source: "builtin",
  },
  {
    name: "logout",
    description: "Remove provider authentication",
    source: "builtin",
  },
  { name: "new", description: "Start a new session", source: "builtin" },
  {
    name: "compact",
    description: "Manually compact context",
    source: "builtin",
  },
  {
    name: "resume",
    description: "Resume a different session",
    source: "builtin",
  },
  {
    name: "reload",
    description: "Reload keybindings, extensions, skills, prompts, and themes",
    source: "builtin",
  },
  { name: "quit", description: "Quit Pi", source: "builtin" },
];

type StyleText = (color: ThemeColor, text: string) => string;

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeToSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export class CommandPaletteOverlay implements Component {
  private query: string;
  private selectedIndex = 0;
  private scrollOffset = 0;

  constructor(
    private readonly items: CommandPaletteItem[],
    initialQuery: string,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly done: (result: CommandPaletteResult | null) => void,
  ) {
    this.query = initialQuery.replace(/^\//, "");
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const filtered = this.getFilteredItems();

    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape)
    ) {
      this.done(null);
      return;
    }

    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex =
        filtered.length === 0 ? 0 : Math.max(0, this.selectedIndex - 1);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex =
        filtered.length === 0
          ? 0
          : Math.min(filtered.length - 1, this.selectedIndex + 1);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - MAX_ROWS);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.selectedIndex =
        filtered.length === 0
          ? 0
          : Math.min(filtered.length - 1, this.selectedIndex + MAX_ROWS);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }

    if (
      this.keybindings.matches(data, "tui.input.tab") ||
      matchesKey(data, Key.tab)
    ) {
      const selected = filtered[this.selectedIndex];
      this.done(selected ? { command: selected.name, action: "insert" } : null);
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = filtered[this.selectedIndex];
      this.done(
        selected
          ? {
              command: selected.name,
              action: getDefaultCommandAction(selected),
            }
          : null,
      );
      return;
    }

    if (isClearQueryKey(data, this.keybindings)) {
      this.query = "";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    if (
      this.keybindings.matches(data, "tui.editor.deleteCharBackward") ||
      matchesKey(data, Key.backspace)
    ) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    const printable = getPrintableInput(data);
    if (printable) {
      this.query += printable;
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const boxWidth = Math.max(MIN_WIDTH, width);
    const innerWidth = Math.max(1, boxWidth - 2);
    const contentWidth = Math.max(1, innerWidth - SIDE_PADDING * 2);
    const filtered = this.getFilteredItems();
    this.selectedIndex =
      filtered.length === 0
        ? 0
        : Math.min(this.selectedIndex, filtered.length - 1);
    this.ensureSelectionVisible();

    const visibleItems = filtered.slice(
      this.scrollOffset,
      this.scrollOffset + MAX_ROWS,
    );
    const rows =
      visibleItems.length > 0
        ? visibleItems.map((item, index) =>
            this.renderItem(
              item,
              this.scrollOffset + index === this.selectedIndex,
              contentWidth,
            ),
          )
        : [this.fg("warning", "No commands match")];

    return [
      topBorder(boxWidth, this.theme),
      wrapContent(this.renderInput(contentWidth), boxWidth, this.theme),
      wrapContent("", boxWidth, this.theme),
      ...rows.map((row) => wrapContent(row, boxWidth, this.theme)),
      wrapContent(
        this.renderCount(filtered.length, contentWidth),
        boxWidth,
        this.theme,
      ),
      bottomBorder(boxWidth, this.theme),
    ];
  }

  private ensureSelectionVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
      return;
    }

    const lastVisibleIndex = this.scrollOffset + MAX_ROWS - 1;
    if (this.selectedIndex > lastVisibleIndex) {
      this.scrollOffset = this.selectedIndex - MAX_ROWS + 1;
    }
  }

  private getFilteredItems(): CommandPaletteItem[] {
    const deduped = dedupeItems(this.items);
    if (!this.query.trim()) return deduped;
    return fuzzyFilter(deduped, this.query, (item) =>
      [item.name, item.description, item.source]
        .filter((value): value is string => value !== undefined)
        .map(normalizeToSingleLine)
        .join(" "),
    );
  }

  private renderInput(width: number): string {
    const prompt = this.fg("dim", "> ");
    const text = this.fg("text", this.query);
    return truncateToWidth(prompt + text, width, "…", true);
  }

  private renderItem(
    item: CommandPaletteItem,
    selected: boolean,
    width: number,
  ): string {
    const sourceWidth = 12;
    const descriptionWidth = Math.max(0, Math.floor(width * 0.45));
    const nameWidth = Math.max(8, width - sourceWidth - descriptionWidth - 4);
    const marker = selected ? this.fg("accent", "→ ") : "  ";
    const sourceText = item.source ? normalizeToSingleLine(item.source) : "";
    const nameText = normalizeToSingleLine(item.name);
    const descriptionText = item.description
      ? normalizeToSingleLine(item.description)
      : "";
    const source = sourceText
      ? this.fg("muted", truncateToWidth(sourceText, sourceWidth, "…"))
      : "";
    const nameColor: ThemeColor = selected ? "accent" : "text";
    const name = this.fg(nameColor, truncateToWidth(nameText, nameWidth, "…"));
    const description = descriptionText
      ? this.fg(
          selected ? "text" : "muted",
          truncateToWidth(descriptionText, descriptionWidth, "…"),
        )
      : "";
    const left = padVisible(`${marker}${source}`, sourceWidth + 2);
    const middle = padVisible(name, nameWidth + 2);
    return truncateToWidth(`${left}${middle}${description}`, width, "", true);
  }

  private renderCount(total: number, width: number): string {
    const shown = Math.min(total, MAX_ROWS);
    const text = total > MAX_ROWS ? `(${shown}/${total})` : `(${total})`;
    return truncateToWidth(this.fg("dim", text), width, "");
  }

  private fg(color: ThemeColor, text: string): string {
    return this.theme.fg(color, text);
  }
}

function getDefaultCommandAction(
  item: CommandPaletteItem,
): CommandPaletteResult["action"] {
  return item.source === "skill" || item.source === "prompt"
    ? "insert"
    : "submit";
}

function dedupeItems(items: CommandPaletteItem[]): CommandPaletteItem[] {
  const seen = new Set<string>();
  const result: CommandPaletteItem[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    result.push(item);
  }
  return result;
}

function isClearQueryKey(
  data: string,
  keybindings: KeybindingsManager,
): boolean {
  const parsed = parseKey(data);
  return (
    data === "\x15" ||
    keybindings.matches(data, "tui.editor.deleteToLineStart") ||
    matchesKey(data, Key.ctrl("u")) ||
    matchesKey(data, Key.super("backspace")) ||
    matchesKey(data, Key.super("delete")) ||
    parsed === "super+backspace" ||
    parsed === "super+delete" ||
    parsed === "ctrl+backspace" ||
    parsed === "ctrl+delete"
  );
}

function getPrintableInput(data: string): string {
  if (data.length === 1 && data >= " " && data !== "\x7f") return data;
  return "";
}

function topBorder(width: number, theme: Theme): string {
  const innerWidth = Math.max(0, width - 2);
  const titleWidth = visibleWidth(TITLE);
  if (innerWidth < titleWidth + 2)
    return theme.fg("accent", `╭${"─".repeat(innerWidth)}╮`);

  const leftFill = Math.max(1, Math.floor((innerWidth - titleWidth) / 2));
  const rightFill = Math.max(0, innerWidth - titleWidth - leftFill);
  const title = theme.fg("accent", theme.bold(TITLE));
  return (
    theme.fg("accent", `╭${"─".repeat(leftFill)}`) +
    title +
    theme.fg("accent", `${"─".repeat(rightFill)}╮`)
  );
}

function bottomBorder(width: number, theme: Theme): string {
  const innerWidth = Math.max(0, width - 2);
  if (innerWidth < visibleWidth(HELP_HINT) + 2)
    return theme.fg("accent", `╰${"─".repeat(innerWidth)}╯`);

  const label = theme.fg("dim", HELP_HINT);
  const fill = Math.max(0, innerWidth - visibleWidth(HELP_HINT) - 1);
  return (
    theme.fg("accent", "╰") +
    theme.fg("accent", "─".repeat(fill)) +
    label +
    theme.fg("accent", "─╯")
  );
}

function wrapContent(line: string, width: number, theme: Theme): string {
  const innerWidth = Math.max(1, width - 2 - SIDE_PADDING * 2);
  const clipped = truncateToWidth(line, innerWidth, "", true);
  return (
    theme.fg("accent", "│") +
    " ".repeat(SIDE_PADDING) +
    padVisible(clipped, innerWidth) +
    " ".repeat(SIDE_PADDING) +
    theme.fg("accent", "│")
  );
}

function padVisible(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}
