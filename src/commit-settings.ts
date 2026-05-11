import type { SettingDefinition } from "@juanibiapina/pi-extension-settings";
import { getSetting } from "@juanibiapina/pi-extension-settings";

export type AutoCommitVerifiedWork = "off" | "ask" | "on";

export const AUTO_COMMIT_VERIFIED_WORK_DEFAULT: AutoCommitVerifiedWork = "ask";
export const GEDPI_SETTINGS_EXTENSION_NAME = "gedpi";
export const AUTO_COMMIT_VERIFIED_WORK_SETTING_ID = "autoCommitVerifiedWork";

export const GEDPI_EXTENSION_SETTINGS: SettingDefinition[] = [
  {
    id: AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
    label: "Commit after verification",
    description:
      "Controls whether GedPi commits verified work: off leaves changes uncommitted, ask prompts first, on commits after successful verification.",
    defaultValue: AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
    values: ["off", "ask", "on"],
  },
];

export type GetSettingFn = (
  extensionName: string,
  settingId: string,
  defaultValue?: string,
) => string | undefined;

export function normalizeAutoCommitVerifiedWork(
  value: unknown,
): AutoCommitVerifiedWork {
  return value === "off" || value === "on" || value === "ask"
    ? value
    : AUTO_COMMIT_VERIFIED_WORK_DEFAULT;
}

export function readAutoCommitVerifiedWork(
  getter: GetSettingFn = getSetting,
): AutoCommitVerifiedWork {
  return normalizeAutoCommitVerifiedWork(
    getter(
      GEDPI_SETTINGS_EXTENSION_NAME,
      AUTO_COMMIT_VERIFIED_WORK_SETTING_ID,
      AUTO_COMMIT_VERIFIED_WORK_DEFAULT,
    ),
  );
}

export function buildAutoCommitWorkflowPrompt(
  preference: AutoCommitVerifiedWork,
): string {
  const instructions = {
    off: "After verification passes, do not commit unless the user explicitly asks. Summarize the verified changes and say they are left uncommitted.",
    ask: "After verification passes, ask the user whether to commit before running git commit.",
    on: "After verification passes and verifier findings are adjudicated, create a conventional git commit without asking for another confirmation.",
  } satisfies Record<AutoCommitVerifiedWork, string>;

  return `## Commit Preference

Current setting: ${preference}

${instructions[preference]}

Always use the normal git command path so checkpoint guards still apply. Never commit before planned checks pass and verifier findings are adjudicated. Never push unless the user explicitly asks.`;
}
