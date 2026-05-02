import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

export interface AppCommandContext {
  cwd: string;
  args?: string[];
  runtime?: {
    pi: ExtensionAPI;
    ctx: ExtensionCommandContext;
  };
}

export interface StructuredResult {
  text: string;
  messageType?: string;
  details?: Record<string, unknown>;
}

export type CommandResult = string | StructuredResult;

export interface AppCommandDefinition {
  name: string;
  description: string;
  execute: (context: AppCommandContext) => Promise<CommandResult>;
}

function splitArgs(rawArgs: string): string[] {
  const trimmed = rawArgs.trim();
  return trimmed.length > 0 ? trimmed.split(/\s+/u) : [];
}

async function emitResult(
  result: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (result.trim().length === 0) {
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify(result, "info");
  } else {
    console.log(result);
  }
}

interface VerificationDetails {
  title?: string;
  passed?: boolean;
  checksRun?: string[];
  failureSummary?: string[];
}

interface StatusDetails {
  title?: string;
  phase?: string;
  activeTask?: string;
  blockers?: string[];
  nextStep?: string;
  recoveryOptions?: string[];
}

interface EscalationDetails {
  title?: string;
  taskId?: string;
  priorAttempts?: number;
  failedChecks?: string[];
}

function renderVerificationMessage(
  message: { content: unknown; details?: unknown },
  expanded: boolean,
  theme: Theme,
): { box: InstanceType<typeof Box> } {
  const body =
    typeof message.content === "string"
      ? message.content
      : String(message.content ?? "");
  const details = (message.details ?? {}) as VerificationDetails;
  const icon = details.passed ? "✓" : "✗";
  const color = details.passed ? "accent" : "error";
  const header = theme.fg(
    color,
    theme.bold(`${icon} ${details.title ?? "Verification"}`),
  );
  const checksLine = details.checksRun?.length
    ? `Checks: ${details.checksRun.join(", ")}`
    : "";
  const failureLine = details.failureSummary?.length
    ? `Failures: ${details.failureSummary.join("; ")}`
    : "";
  const lines = [header, body, checksLine, failureLine].filter(Boolean);
  const box = new Box(1, 1, (text: string) =>
    theme.bg("customMessageBg", text),
  );
  box.addChild(
    new Text(expanded ? lines.join("\n\n") : lines.join("\n"), 0, 0),
  );
  return { box };
}

function renderStatusMessage(
  message: { content: unknown; details?: unknown },
  expanded: boolean,
  theme: Theme,
): { box: InstanceType<typeof Box> } {
  const body =
    typeof message.content === "string"
      ? message.content
      : String(message.content ?? "");
  const details = (message.details ?? {}) as StatusDetails;
  const header = theme.fg(
    "accent",
    theme.bold(details.title ?? "GedPi Status"),
  );
  const lines = [header];
  if (details.phase) lines.push(`Phase: ${details.phase}`);
  if (details.activeTask) lines.push(`Task: ${details.activeTask}`);
  if (expanded) lines.push(body);
  if (details.blockers?.length)
    lines.push(`Blockers: ${details.blockers.join("; ")}`);
  if (details.nextStep) lines.push(`Next: ${details.nextStep}`);
  if (details.recoveryOptions?.length) {
    lines.push("Recovery options:");
    for (const option of details.recoveryOptions) lines.push(`  - ${option}`);
  }
  const box = new Box(1, 1, (text: string) =>
    theme.bg("customMessageBg", text),
  );
  box.addChild(new Text(lines.join("\n"), 0, 0));
  return { box };
}

function renderEscalationMessage(
  message: { content: unknown; details?: unknown },
  expanded: boolean,
  theme: Theme,
): { box: InstanceType<typeof Box> } {
  const body =
    typeof message.content === "string"
      ? message.content
      : String(message.content ?? "");
  const details = (message.details ?? {}) as EscalationDetails;
  const header = theme.fg(
    "warning",
    theme.bold(`⚠ ${details.title ?? "Escalation"}`),
  );
  const lines = [header];
  if (details.taskId) lines.push(`Task: ${details.taskId}`);
  if (details.priorAttempts != null)
    lines.push(`Prior attempts: ${details.priorAttempts}`);
  if (details.failedChecks?.length)
    lines.push(`Failed checks: ${details.failedChecks.join(", ")}`);
  if (expanded) lines.push(body);
  const box = new Box(1, 1, (text: string) =>
    theme.bg("customMessageBg", text),
  );
  box.addChild(new Text(lines.join("\n"), 0, 0));
  return { box };
}

export function registerGedMessageRenderer(api: ExtensionAPI): void {
  api.registerMessageRenderer("ged-update", (message, { expanded }, theme) => {
    const body =
      typeof message.content === "string"
        ? message.content
        : String(message.content ?? "");
    const details = (message.details ?? {}) as { title?: string };
    const lines = [
      theme.fg("accent", theme.bold(details.title ?? "GedPi")),
      body,
    ];
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(
      new Text(expanded ? lines.join("\n\n") : lines.join("\n"), 0, 0),
    );
    return box;
  });

  api.registerMessageRenderer(
    "ged-verification",
    (message, { expanded }, theme) => {
      return renderVerificationMessage(message, expanded, theme).box;
    },
  );

  api.registerMessageRenderer("ged-status", (message, { expanded }, theme) => {
    return renderStatusMessage(message, expanded, theme).box;
  });

  api.registerMessageRenderer(
    "ged-escalation",
    (message, { expanded }, theme) => {
      return renderEscalationMessage(message, expanded, theme).box;
    },
  );
}

function normalizeResult(raw: CommandResult): StructuredResult {
  if (typeof raw === "string") {
    return { text: raw };
  }
  return raw;
}

export function registerPiCommands(
  api: ExtensionAPI,
  commands: AppCommandDefinition[],
): void {
  for (const command of commands) {
    api.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        const raw = await command.execute({
          cwd: ctx.cwd,
          args: splitArgs(args),
          runtime: {
            pi: api,
            ctx,
          },
        });
        const result = normalizeResult(raw);
        if (result.text.trim().length > 0 && ctx.hasUI) {
          api.sendMessage({
            customType: result.messageType ?? "ged-update",
            content: result.text,
            display: true,
            details: { title: command.name, ...result.details },
          });
        } else {
          await emitResult(result.text, ctx);
        }
      },
    });
  }
}
