import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const WELCOME_MESSAGES: readonly string[] = [
  "Ready to turn ideas into code.",
  "What are we building today?",
  "Your brain is warmed up and ready.",
  "Let's ship something great.",
  "All systems nominal. Awaiting orders.",
  "Standing by for your next move.",
  "The plan-build-verify loop awaits.",
  "Focus loaded. Distractions discarded.",
  "Initialized. Let's make it happen.",
  "Another day, another deploy.",
  "Spec it. Build it. Verify it.",
  "Engineering mode: activated.",
  "Coffee optional. Code inevitable.",
  "Ctrl+C is always an option. But not today.",
];

function loadVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Read once at module load — package.json doesn't change while the
// process is running, so re-parsing on every render is wasted work.
const VERSION = loadVersion();

export function pickWelcome(): string {
  return WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
}

export function renderHeader(theme: Theme): Text {
  const welcome = pickWelcome();

  const subtitle = theme.fg("muted", `— GedPi v${VERSION} —`);
  const tagline = theme.fg("muted", "plan · build · verify");
  const greeting = theme.fg("accent", welcome);

  const lines = [subtitle, tagline, greeting, ""];
  return new Text(lines.join("\n"), 1, 0);
}
