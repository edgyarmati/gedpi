import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { readGedMode } from "./theme.js";

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseStateFields(
  raw: string,
): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      fields.push({
        label: trimmed.slice(0, colonIdx).trim(),
        value: trimmed.slice(colonIdx + 1).trim(),
      });
    }
  }
  return fields;
}

function renderState(
  fields: Array<{ label: string; value: string }>,
  theme: Theme,
): string {
  if (fields.length === 0) return "";

  const lines: string[] = [];
  for (const { label, value } of fields) {
    if (!value || value === "None") continue;
    const styledLabel = theme.fg("muted", `${label}:`);
    lines.push(`  ${styledLabel} ${value}`);
  }
  return lines.join("\n");
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:-]+\|/.test(line) && /^[\s|:-]+$/.test(line);
}

function isTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

type StatusColor = "success" | "accent" | "error" | "muted";

function statusDisplay(value: string): {
  text: string;
  color: StatusColor | null;
} {
  const lower = value.toLowerCase();
  if (lower === "done") return { text: "✓ done", color: "success" };
  if (lower === "in-progress")
    return { text: "▸ in-progress", color: "accent" };
  if (lower === "blocked") return { text: "✗ blocked", color: "error" };
  if (lower === "pending") return { text: "○ pending", color: "muted" };
  return { text: value, color: null };
}

function renderTable(tableLines: string[], theme: Theme): string[] {
  const rows = tableLines.filter((l) => !isSeparatorRow(l)).map(parseTableRow);

  if (rows.length < 2) return tableLines.map((l) => `    ${l}`);

  const header = rows[0];
  const data = rows.slice(1);
  const colCount = header.length;

  // Find the status column index
  const statusIdx = header.findIndex((h) => h.toLowerCase() === "status");

  // Compute column widths using visible text (status icons may differ)
  const visibleData = data.map((row) =>
    row.map((val, i) => (i === statusIdx ? statusDisplay(val).text : val)),
  );
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.max(
      header[i].length,
      ...visibleData.map((row) => (row[i] ?? "").length),
    ),
  );

  // Render header
  const out: string[] = [];
  const headerCells = header.map((h, i) =>
    theme.fg("muted", h.padEnd(widths[i])),
  );
  out.push(`    ${headerCells.join(theme.fg("border", " │ "))}`);

  // Separator
  const sep = widths.map((w) => "─".repeat(w));
  out.push(`    ${theme.fg("border", sep.join("─┼─"))}`);

  // Data rows
  for (const row of data) {
    const cells = header.map((_, i) => {
      const val = row[i] ?? "";
      if (i === statusIdx) {
        const { text, color } = statusDisplay(val);
        const padded = text.padEnd(widths[i]);
        return color ? theme.fg(color, padded) : padded;
      }
      return val.padEnd(widths[i]);
    });
    out.push(`    ${cells.join(theme.fg("border", " │ "))}`);
  }

  return out;
}

function renderTasks(raw: string, theme: Theme): string {
  const lines: string[] = [];
  let hasContent = false;
  const rawLines = raw.split("\n");
  let i = 0;

  while (i < rawLines.length) {
    const trimmed = rawLines[i].trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Headings
    if (trimmed.startsWith("#")) {
      if (hasContent) lines.push("");
      const title = trimmed.replace(/^#+\s*/, "");
      lines.push(`  ${theme.fg("accent", theme.bold(title))}`);
      hasContent = true;
      i += 1;
      continue;
    }

    // Table block
    if (isTableRow(trimmed)) {
      const tableLines: string[] = [];
      while (i < rawLines.length && isTableRow(rawLines[i].trim())) {
        tableLines.push(rawLines[i].trim());
        i += 1;
      }
      lines.push(...renderTable(tableLines, theme));
      hasContent = true;
      continue;
    }

    // Checkboxes and list items
    if (/^- \[x\]/i.test(trimmed)) {
      lines.push(
        `    ${theme.fg("success", "✓")} ${theme.fg("muted", trimmed.slice(6))}`,
      );
    } else if (/^- \[ \]/.test(trimmed)) {
      lines.push(`    ${theme.fg("warning", "○")} ${trimmed.slice(6)}`);
    } else if (trimmed.startsWith("- ")) {
      lines.push(`    • ${trimmed.slice(2)}`);
    } else {
      lines.push(`    ${trimmed}`);
    }
    hasContent = true;
    i += 1;
  }

  return lines.join("\n");
}

function countTasks(raw: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (/^- \[x\]/i.test(trimmed)) {
      done += 1;
      total += 1;
    } else if (/^- \[ \]/.test(trimmed)) {
      total += 1;
    }
  }
  return { done, total };
}

let widgetVisible = false;

async function renderTodoWidget(ctx: ExtensionContext): Promise<void> {
  if (!readGedMode(ctx.cwd)) {
    ctx.ui.notify(
      "Ged task widgets are only available while Ged mode is ON.",
      "info",
    );
    ctx.ui.setWidget("ged-todos", undefined);
    widgetVisible = false;
    return;
  }

  const tasksContent = await readOptional(
    path.join(ctx.cwd, ".ged", "TASKS.md"),
  );
  const stateContent = await readOptional(
    path.join(ctx.cwd, ".ged", "STATE.md"),
  );

  if (!tasksContent && !stateContent) {
    ctx.ui.notify("No tasks or state found in .ged/", "info");
    widgetVisible = false;
    return;
  }

  ctx.ui.setWidget(
    "ged-todos",
    (_tui, theme) => {
      const sections: string[] = [];

      // Title bar
      const titleParts = [theme.fg("accent", theme.bold("📋 GedPi Tasks"))];
      if (tasksContent) {
        const { done, total } = countTasks(tasksContent);
        if (total > 0) {
          const pct = Math.round((done / total) * 100);
          const color =
            pct === 100 ? "success" : pct > 50 ? "warning" : "muted";
          titleParts.push(theme.fg(color, `${done}/${total} (${pct}%)`));
        }
      }
      sections.push(titleParts.join("  "));

      // State section
      if (stateContent) {
        const fields = parseStateFields(stateContent);
        const stateStr = renderState(fields, theme);
        if (stateStr) {
          sections.push(stateStr);
        }
      }

      // Separator
      if (stateContent && tasksContent) {
        sections.push(theme.fg("border", "  ─────────────────────────"));
      }

      // Tasks section
      if (tasksContent) {
        sections.push(renderTasks(tasksContent, theme));
      }

      const content = sections.filter(Boolean).join("\n");
      const box = new Box(1, 0, (text: string) =>
        theme.bg("customMessageBg", text),
      );
      box.addChild(new Text(content, 0, 0));
      return box;
    },
    { placement: "aboveEditor" },
  );
}

function hideTodoWidget(ctx: ExtensionContext): void {
  ctx.ui.setWidget("ged-todos", undefined);
}

export function registerTodoShortcut(api: ExtensionAPI): void {
  api.registerShortcut("ctrl+shift+t", {
    description: "Toggle GedPi task list",
    async handler(ctx: ExtensionContext) {
      widgetVisible = !widgetVisible;
      if (widgetVisible) {
        await renderTodoWidget(ctx);
      } else {
        hideTodoWidget(ctx);
      }
    },
  });

  // Auto-refresh widget after each turn if visible
  api.on("turn_end", async (_event, ctx) => {
    if (widgetVisible) {
      await renderTodoWidget(ctx);
    }
  });
}
