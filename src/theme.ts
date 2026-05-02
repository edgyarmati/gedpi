import { mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Theme } from "@mariozechner/pi-coding-agent";

import { writeFileAtomicSync } from "./atomic.js";

// ── Curated presets ──────────────────────────────────────────────

export interface GedPreset {
  readonly label: string;
  readonly brand: string;
  readonly welcome: string;
}

export const PRESETS: Record<string, GedPreset> = {
  lavender: {
    label: "Lavender",
    brand: "#c5bceb",
    welcome: "#4969c9",
  },
  ember: {
    label: "Ember",
    brand: "#e8836b",
    welcome: "#d4a054",
  },
  ocean: {
    label: "Ocean",
    brand: "#5fb3d4",
    welcome: "#4a90b8",
  },
  mint: {
    label: "Mint",
    brand: "#7ecba1",
    welcome: "#52a37a",
  },
  rose: {
    label: "Rose",
    brand: "#e88aaf",
    welcome: "#c76b8f",
  },
  gold: {
    label: "Gold",
    brand: "#d4b96a",
    welcome: "#b89b4a",
  },
  arctic: {
    label: "Arctic",
    brand: "#a0c4e8",
    welcome: "#7ba3cc",
  },
  neon: {
    label: "Neon",
    brand: "#b97aff",
    welcome: "#ff6bde",
  },
  copper: {
    label: "Copper",
    brand: "#d4956a",
    welcome: "#b87a4f",
  },
  slate: {
    label: "Slate",
    brand: "#8fa3b8",
    welcome: "#6b8299",
  },
};

export const DEFAULT_PRESET = "lavender";

// ── Runtime state ────────────────────────────────────────────────

let activeBrand = PRESETS[DEFAULT_PRESET].brand;
let activeWelcome = PRESETS[DEFAULT_PRESET].welcome;
let activePresetName: string | null = DEFAULT_PRESET;

export function getBrandHex(): string {
  return activeBrand;
}

export function getWelcomeHex(): string {
  return activeWelcome;
}

export function getActivePresetName(): string | null {
  return activePresetName;
}

export function applyPreset(name: string): void {
  const preset = PRESETS[name];
  if (!preset) return;
  activeBrand = preset.brand;
  activeWelcome = preset.welcome;
  activePresetName = name;
}

// ── Persistence (.pi/settings.json) ─────────────────────────────

export type RtkMode = "off" | "auto";

interface PiSettings {
  quietStartup?: boolean;
  gedTheme?: string;
  gedMode?: boolean;
  rtkMode?: RtkMode;
  [key: string]: unknown;
}

function settingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

function readSettings(cwd: string): PiSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(cwd), "utf8")) as PiSettings;
  } catch {
    return {};
  }
}

export function readPiSettings(cwd: string): PiSettings {
  return readSettings(cwd);
}

function writeSettings(cwd: string, settings: PiSettings): void {
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  writeFileAtomicSync(
    settingsPath(cwd),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

export async function ensurePiSettings(cwd: string): Promise<void> {
  const p = settingsPath(cwd);
  try {
    readFileSync(p);
  } catch {
    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    writeSettings(cwd, { quietStartup: true });
  }
}

export function readGedMode(cwd: string): boolean {
  return readSettings(cwd).gedMode === true;
}

export function saveGedMode(cwd: string, enabled: boolean): void {
  const settings = readSettings(cwd);
  writeSettings(cwd, { ...settings, gedMode: enabled });
}

export function readRtkMode(cwd: string): RtkMode {
  return readSettings(cwd).rtkMode === "auto" ? "auto" : "off";
}

export function saveRtkMode(cwd: string, mode: RtkMode): void {
  const settings = readSettings(cwd);
  writeSettings(cwd, { ...settings, rtkMode: mode });
}

/** Load the saved theme from .pi/settings.json, or fall back to default. */
export function loadSavedTheme(cwd: string): void {
  const settings = readSettings(cwd);
  const name = settings.gedTheme;
  if (typeof name === "string" && name in PRESETS) {
    applyPreset(name);
  } else {
    applyPreset(DEFAULT_PRESET);
  }
}

/** Persist the chosen preset to .pi/settings.json. */
export function saveThemeChoice(cwd: string, presetName: string): void {
  const settings = readSettings(cwd);
  writeSettings(cwd, { ...settings, gedTheme: presetName });
}

// ── ANSI helpers ─────────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function ansiColor(hex: string, text: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}${ANSI_RESET}`;
}

export function formatGedModeStatus(enabled: boolean): string {
  const label = enabled ? "Ged mode ON" : "Ged mode OFF";
  return enabled
    ? `${ansiColor(activeBrand, label)}  \x1b[2mctrl+shift+t tasks\x1b[0m`
    : `\x1b[2m${label}  ctrl+shift+t tasks\x1b[0m`;
}

/** Wrap text in true-color ANSI foreground using the active brand color. */
export function brand(text: string): string {
  return ansiColor(activeBrand, text);
}

/** Wrap text in true-color ANSI foreground using the active welcome color. */
export function welcome(text: string): string {
  return ansiColor(activeWelcome, text);
}

// ── Theme constructor ────────────────────────────────────────────

/**
 * GedPi theme — dark base with brand accent.
 * Reads the active brand color so `/theme` changes propagate.
 */
export function createGedTheme(): Theme {
  const accent = activeBrand;
  return new Theme(
    {
      accent,
      border: "#5f87ff",
      borderAccent: accent,
      borderMuted: "#505050",
      success: "#b5bd68",
      error: "#cc6666",
      warning: "#ffff00",
      muted: "#808080",
      dim: "#666666",
      text: "",
      thinkingText: "#808080",
      userMessageText: "",
      customMessageText: "",
      customMessageLabel: "#9575cd",
      toolTitle: "",
      toolOutput: "#808080",
      mdHeading: "#f0c674",
      mdLink: "#81a2be",
      mdLinkUrl: "#666666",
      mdCode: accent,
      mdCodeBlock: "#b5bd68",
      mdCodeBlockBorder: "#808080",
      mdQuote: "#808080",
      mdQuoteBorder: "#808080",
      mdHr: "#808080",
      mdListBullet: accent,
      toolDiffAdded: "#b5bd68",
      toolDiffRemoved: "#cc6666",
      toolDiffContext: "#808080",
      syntaxComment: "#6A9955",
      syntaxKeyword: "#569CD6",
      syntaxFunction: "#DCDCAA",
      syntaxVariable: "#9CDCFE",
      syntaxString: "#CE9178",
      syntaxNumber: "#B5CEA8",
      syntaxType: "#4EC9B0",
      syntaxOperator: "#D4D4D4",
      syntaxPunctuation: "#D4D4D4",
      thinkingOff: "#505050",
      thinkingMinimal: "#6e6e6e",
      thinkingLow: "#5f87af",
      thinkingMedium: "#81a2be",
      thinkingHigh: "#b294bb",
      thinkingXhigh: "#d183e8",
      bashMode: "#b5bd68",
    },
    {
      selectedBg: "#3a3a4a",
      userMessageBg: "#343541",
      customMessageBg: "#2d2838",
      toolPendingBg: "#282832",
      toolSuccessBg: "#283228",
      toolErrorBg: "#3c2828",
    },
    "truecolor",
    { name: "gedpi" },
  );
}
