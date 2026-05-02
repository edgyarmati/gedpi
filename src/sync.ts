import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./atomic.js";

export interface SyncRequest {
  summary: string;
  decisions?: string[];
  nextHandoffNotes?: string[];
}

// Sync inputs (summary, decisions, handoff notes) come from the user
// or the brain at runtime. Bullets are nested under markdown headings
// so a decision containing newlines, an indented "- " line, or a "## "
// could quietly close out the active section or invent fake bullets.
// Collapse to one line, strip control chars, drop leading "##/-/+" so
// the rendered bullet stays well-formed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars from runtime-provided bullets is the point.
const BULLET_CONTROL = /[\u0000-\u001f\u007f]/gu;

function sanitizeBulletLine(value: string, maxLen = 800): string {
  return value
    .replace(BULLET_CONTROL, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[-+#*]+\s*/u, "")
    .trim()
    .slice(0, maxLen);
}

async function appendBullets(
  filePath: string,
  heading: string,
  bullets: string[],
): Promise<void> {
  if (bullets.length === 0) {
    return;
  }

  const content = await readFile(filePath, "utf8");
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(
    `(${escapedHeading}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const match = content.match(sectionRegex);
  if (!match) {
    await writeFileAtomic(
      filePath,
      `${content.trimEnd()}\n\n${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n`,
    );
    return;
  }

  const prefix = match[1];
  const body = match[2].trimEnd();
  const merged = [body, ...bullets.map((bullet) => `- ${bullet}`)]
    .filter(Boolean)
    .join("\n");
  await writeFileAtomic(
    filePath,
    content.replace(sectionRegex, `${prefix}${merged}\n`),
  );
}

export async function syncGedMemory(
  rootDir: string,
  request: SyncRequest,
): Promise<void> {
  const sessionPath = path.join(rootDir, ".ged", "SESSION-SUMMARY.md");
  const decisionsPath = path.join(rootDir, ".ged", "DECISIONS.md");

  const safeSummary = sanitizeBulletLine(request.summary);
  if (safeSummary) {
    await appendBullets(sessionPath, "## Recent progress", [safeSummary]);
  }
  const safeHandoff = (request.nextHandoffNotes ?? [])
    .map((note) => sanitizeBulletLine(note))
    .filter((note) => note.length > 0);
  await appendBullets(sessionPath, "## Next handoff notes", safeHandoff);

  const safeDecisions = (request.decisions ?? [])
    .map((decision) => sanitizeBulletLine(decision))
    .filter((decision) => decision.length > 0);

  if (safeDecisions.length > 0) {
    const decisionLines = safeDecisions.map(
      (decision) =>
        `Date: pending\n  - Decision: ${decision}\n  - Why: Captured during sync.\n  - Impact: To be refined.`,
    );
    const content = await readFile(decisionsPath, "utf8");
    const next = `${content.trimEnd()}\n${decisionLines.map((line) => `\n- ${line}`).join("\n")}\n`;
    await writeFileAtomic(decisionsPath, next);
  }
}
