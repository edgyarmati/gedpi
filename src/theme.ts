import { mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomicSync } from "./atomic.js";

// ── Persistence (.pi/settings.json) ─────────────────────────────

interface PiSettings {
  quietStartup?: boolean;
  theme?: string;
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
  const existing = readSettings(cwd);
  let modified = false;

  // Preserve original first-run defaults
  if (existing.quietStartup === undefined) {
    existing.quietStartup = true;
    modified = true;
  }

  // One-time cleanup: remove the old hardcoded "dark" fallback that
  // ensurePiSettings() used to write. It overrides the user's global
  // theme choice (e.g. amp-gruvbox-dark-hard) because Pi resolves
  // project-local settings first. Users who genuinely want "dark" can
  // re-select it via /settings — it will be stored globally.
  if (existing.theme === "dark") {
    delete existing.theme;
    modified = true;
  }

  // RTK routing is now automatic when the `rtk` binary is installed, so
  // remove the old persisted opt-in/opt-out setting if present.
  if ("rtkMode" in existing) {
    delete existing.rtkMode;
    modified = true;
  }

  if (modified) {
    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    writeSettings(cwd, existing);
  }
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

/** Fixed GedPi brand color for the status indicator. */
export function formatGedStatus(): string {
  return ansiColor("#c5bceb", "GedPi");
}
