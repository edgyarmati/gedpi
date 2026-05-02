import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import type { GedState } from "../../src/contracts.js";
import { runDoctor } from "../../src/doctor.js";
import { renderCompactStatusWidget } from "../../src/status.js";
import { readGedMode } from "../../src/theme.js";

async function readState(cwd: string): Promise<GedState | null> {
  try {
    const content = await readFile(path.join(cwd, ".ged", "STATE.md"), "utf8");
    const matchValue = (label: string): string => {
      const regex = new RegExp(`^${label}:\\s*(.*)$`, "mu");
      return content.match(regex)?.[1]?.trim() ?? "";
    };
    const blockersValue = matchValue("Blockers");
    const recoveryMatch = content.match(/Recovery Options:\n((?:- .*\n?)*)/u);
    const recoveryOptions = recoveryMatch
      ? recoveryMatch[1]
          .split("\n")
          .map((line) => line.replace(/^- /u, "").trim())
          .filter(Boolean)
      : undefined;
    return {
      currentPhase: matchValue(
        "Current Phase",
      ).toLowerCase() as GedState["currentPhase"],
      activeTask: matchValue("Active Task"),
      statusSummary: matchValue("Status Summary"),
      blockers:
        blockersValue && blockersValue !== "None"
          ? blockersValue.split(/;\s*/u)
          : [],
      nextStep: matchValue("Next Step"),
      recoveryOptions,
    };
  } catch {
    return null;
  }
}

async function updateWidget(ctx: ExtensionContext): Promise<void> {
  if (!readGedMode(ctx.cwd)) {
    ctx.ui.setWidget("ged-dashboard", undefined);
    return;
  }
  const state = await readState(ctx.cwd);
  if (state) {
    const report = await runDoctor(ctx.cwd);
    ctx.ui.setWidget(
      "ged-dashboard",
      (_tui, theme) => renderCompactStatusWidget(state, theme, report.overall),
      { placement: "aboveEditor" },
    );
  } else {
    ctx.ui.setWidget("ged-dashboard", undefined);
  }
}

export default function gedMemoryExtension(api: ExtensionAPI): void {
  api.on("session_start", async (_event, ctx) => {
    await updateWidget(ctx);
  });

  api.on("turn_end", async (_event, ctx) => {
    await updateWidget(ctx);
  });
}
