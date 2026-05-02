import { type StarterFile, starterFiles } from "./templates.js";

export function listStarterFiles(): StarterFile[] {
  return starterFiles;
}

export function getStarterFile(path: string): StarterFile | undefined {
  return starterFiles.find((file) => file.path === path);
}

export function buildStarterFileMap(): Record<string, string> {
  return Object.fromEntries(
    starterFiles.map((file) => [file.path, file.content]),
  );
}

export function updateStateSummary(
  content: string,
  nextSummary: string,
): string {
  return content.replace(
    /Status Summary:.*/u,
    `Status Summary: ${nextSummary}`,
  );
}
