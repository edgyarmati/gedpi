import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@mariozechner/pi-tui";
import {
  ASCII_LOGO,
  centerIn,
  LOGO_WIDTH,
  pickWelcome,
  renderHeader,
} from "./header.js";
import {
  ansiColor,
  applyPreset,
  createGedTheme,
  getActivePresetName,
  PRESETS,
  saveThemeChoice,
} from "./theme.js";

const PRESET_KEYS = Object.keys(PRESETS);

function renderMiniPreview(brandHex: string, welcomeHex: string): string[] {
  const logo = ASCII_LOGO.map((line) => ansiColor(brandHex, line));
  const tagline = ansiColor(
    "#808080",
    centerIn("plan · build · verify", LOGO_WIDTH),
  );
  const greeting = ansiColor(welcomeHex, centerIn(pickWelcome(), LOGO_WIDTH));
  return [...logo, "", tagline, greeting];
}

type PickerResult = { key: string } | "cancelled";

class ThemePickerComponent implements Component {
  private selectedIndex: number;
  private tui: TUI;
  private kb: KeybindingsManager;
  private done: (result: PickerResult) => void;
  private originalKey: string;

  invalidate(): void {
    // No cached state to clear — render() is always fresh.
  }

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    done: (result: PickerResult) => void,
    currentKey: string,
  ) {
    this.tui = tui;
    this.kb = keybindings;
    this.done = done;
    this.originalKey = currentKey;
    this.selectedIndex = Math.max(0, PRESET_KEYS.indexOf(currentKey));
  }

  handleInput(data: string): void {
    const prev = this.selectedIndex;

    if (this.kb.matches(data, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? PRESET_KEYS.length - 1
          : this.selectedIndex - 1;
    } else if (this.kb.matches(data, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === PRESET_KEYS.length - 1
          ? 0
          : this.selectedIndex + 1;
    } else if (this.kb.matches(data, "tui.select.confirm")) {
      this.done({ key: PRESET_KEYS[this.selectedIndex] });
      return;
    } else if (this.kb.matches(data, "tui.select.cancel")) {
      this.done("cancelled");
      return;
    }

    if (prev !== this.selectedIndex) {
      this.tui.requestRender(true);
    }
  }

  render(width: number): string[] {
    const key = PRESET_KEYS[this.selectedIndex];
    const preset = PRESETS[key];

    // ── Preview ──
    const preview = renderMiniPreview(preset.brand, preset.welcome);

    // ── List ──
    const listLines = PRESET_KEYS.map((k, i) => {
      const p = PRESETS[k];
      const swatch = ansiColor(p.brand, "████");
      const welcomeSwatch = ansiColor(p.welcome, "██");
      const current = k === this.originalKey ? " *" : "";
      const label = `${swatch} ${welcomeSwatch}  ${p.label}${current}`;
      return i === this.selectedIndex ? ` > ${label}` : `   ${label}`;
    });

    const separator = "─".repeat(Math.min(width, LOGO_WIDTH + 4));
    const hint = "\x1b[2m↑/↓ navigate · enter select · esc cancel\x1b[0m";

    return ["", ...preview, "", separator, ...listLines, "", hint, ""];
  }
}

export function registerThemeCommand(api: ExtensionAPI): void {
  api.registerCommand("theme", {
    description: "Pick an GedPi color theme with live preview",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const originalKey = getActivePresetName() ?? "lavender";

      const result = await ctx.ui.custom<PickerResult>(
        (tui, _theme, keybindings, done) =>
          new ThemePickerComponent(tui, keybindings, done, originalKey),
      );

      if (result === "cancelled") {
        // Revert to original
        applyPreset(originalKey);
        ctx.ui.setTheme(createGedTheme());
        ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
        return;
      }

      applyPreset(result.key);
      ctx.ui.setTheme(createGedTheme());
      ctx.ui.setHeader((_tui, theme) => renderHeader(theme));
      saveThemeChoice(ctx.cwd, result.key);

      const chosen = PRESETS[result.key];
      ctx.ui.notify(
        `Theme set to ${ansiColor(chosen.brand, chosen.label)}`,
        "info",
      );
    },
  });
}
