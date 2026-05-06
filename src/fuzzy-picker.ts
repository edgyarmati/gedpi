import type { Api, Model } from "@mariozechner/pi-ai";
import type {
  ExtensionUIContext,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { Component, KeybindingsManager } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";

// ─── Fuzzy matching ────────────────────────────────────────────────────

/** Case-insensitive subsequence match: all chars of `pattern` appear in `text` in order. */
function fuzzyMatch(text: string, pattern: string): boolean {
  const t = text.toLowerCase();
  const p = pattern.toLowerCase();
  let pi = 0;
  for (let ti = 0; ti < t.length && pi < p.length; ti++) {
    if (t[ti] === p[pi]) pi++;
  }
  return pi === p.length;
}

// ─── Constants ─────────────────────────────────────────────────────────

const MAX_VISIBLE = 10;
const SCROLL_CENTER = Math.floor(MAX_VISIBLE / 2); // cursor stays at position 5

// ─── Fuzzy picker component ────────────────────────────────────────────

class FuzzyModelPicker implements Component {
  private models: Model<Api>[];
  private filtered: Model<Api>[];
  private selectedIndex = 0;
  private filter = "";
  private title: string;
  private done: (result: Model<Api> | null) => void;
  private keybindings: KeybindingsManager;

  constructor(
    title: string,
    models: Model<Api>[],
    done: (result: Model<Api> | null) => void,
    keybindings: KeybindingsManager,
  ) {
    this.title = title;
    this.models = models;
    this.filtered = models;
    this.done = done;
    this.keybindings = keybindings;
  }

  // ── Component interface ──────────────────────────────────────────

  render(width: number): string[] {
    const lines: string[] = [];
    // Title
    lines.push(`\x1b[1m  ${this.title}\x1b[22m`);
    lines.push("");
    // Search line with cursor
    const cursor = "\x1b[7m \x1b[27m";
    lines.push(`  \x1b[90m>\x1b[39m ${this.filter}${cursor}`);

    if (this.filtered.length === 0) {
      lines.push("");
      lines.push("  \x1b[90mNo models matched your search.\x1b[39m");
      return lines;
    }

    // Scroll window
    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - SCROLL_CENTER,
        this.filtered.length - MAX_VISIBLE,
      ),
    );
    const end = Math.min(start + MAX_VISIBLE, this.filtered.length);

    lines.push("");
    for (let i = start; i < end; i++) {
      const m = this.filtered[i];
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? " → " : "   ";
      const label = `${m.provider}/${m.id}`;
      const display = truncateToWidth(
        `${prefix}${label}  ${m.name}`,
        width - 2,
        "",
      );
      lines.push(isSelected ? `\x1b[7m${display}\x1b[27m` : display);
    }

    // Scroll indicator
    if (start > 0 || end < this.filtered.length) {
      lines.push(
        `  \x1b[90m(${this.selectedIndex + 1}/${this.filtered.length})\x1b[39m`,
      );
    }

    return lines;
  }

  handleInput(keyData: string): void {
    // Printable ASCII + common UTF-8 starters
    if (
      keyData.length === 1 &&
      keyData.charCodeAt(0) >= 0x20 &&
      keyData.charCodeAt(0) < 0x7f
    ) {
      this.filter += keyData;
      this.refilter();
      return;
    }

    // Backspace
    if (
      keyData === "\x7f" ||
      keyData === "\b" ||
      this.keybindings.matches(keyData, "tui.editor.deleteCharBackward")
    ) {
      this.filter = this.filter.slice(0, -1);
      this.refilter();
      return;
    }

    // Navigation: up
    if (this.keybindings.matches(keyData, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filtered.length - 1
          : this.selectedIndex - 1;
      return;
    }

    // Navigation: down
    if (this.keybindings.matches(keyData, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.filtered.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }

    // Confirm (Enter)
    if (this.keybindings.matches(keyData, "tui.select.confirm")) {
      const selected = this.filtered[this.selectedIndex];
      if (selected) this.done(selected);
      return;
    }

    // Cancel (Escape / Ctrl+C)
    if (this.keybindings.matches(keyData, "tui.select.cancel")) {
      this.done(null);
      return;
    }
  }

  invalidate(): void {
    // No cached state
  }

  // ── Internal ─────────────────────────────────────────────────────

  private refilter(): void {
    const q = this.filter.trim();
    if (q === "") {
      this.filtered = this.models;
    } else {
      this.filtered = this.models.filter(
        (m) => fuzzyMatch(`${m.provider}/${m.id}`, q) || fuzzyMatch(m.name, q),
      );
    }
    // Clamp selected index
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filtered.length - 1),
    );
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Show a live fuzzy-search model picker with a scrollable list (max 10
 * visible, cursor centered at position 5). Returns the selected model or
 * null if cancelled.
 */
export async function pickModel(
  ui: ExtensionUIContext,
  registry: ModelRegistry,
  title: string,
): Promise<Model<Api> | null> {
  const models = registry.getAvailable();
  if (models.length === 0) {
    ui.notify("No models available in the registry.", "warning");
    return null;
  }
  return ui.custom<Model<Api> | null>((_tui, _theme, keybindings, done) => {
    return new FuzzyModelPicker(title, models, done, keybindings);
  });
}
