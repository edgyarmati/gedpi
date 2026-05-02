import { execFile as execFileCb, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

import { type RtkMode, readRtkMode, saveRtkMode } from "./theme.js";

const execFile = promisify(execFileCb);
const RTK_REWRITE_TIMEOUT_MS = 2_000;
const RTK_INSTALL_TIMEOUT_MS = 180_000;

export interface CommandExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ExecFileFn = (
  command: string,
  args?: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<CommandExecResult>;

export interface InstallPlan {
  label: string;
  command: string;
  shell: string;
  args: string[];
}

export interface RtkRuntimeStatus {
  mode: RtkMode;
  installed: boolean;
  version?: string;
  path?: string;
}

export function formatRtkModeStatus(mode: RtkMode, installed: boolean): string {
  if (mode !== "auto") {
    return "\x1b[2mRTK OFF\x1b[0m";
  }
  return installed ? "RTK AUTO" : "\x1b[33mRTK AUTO (missing)\x1b[0m";
}

export const defaultExecFile: ExecFileFn = async (
  command,
  args = [],
  options = {},
) => {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: 0,
    };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? "",
      code: typeof failure.code === "number" ? failure.code : 1,
    };
  }
};

function parseVersion(output: string): string | undefined {
  const match = output.match(/rtk\s+([^\s]+)/u);
  return match?.[1]?.trim();
}

async function resolveCommandPath(
  command: string,
  exec: ExecFileFn,
  cwd: string,
): Promise<string | undefined> {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = await exec(locator, [command], { cwd, timeout: 5_000 });
  if (result.code !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

export async function detectRtk(
  cwd: string,
  exec: ExecFileFn = defaultExecFile,
): Promise<Omit<RtkRuntimeStatus, "mode">> {
  const versionResult = await exec("rtk", ["--version"], {
    cwd,
    timeout: 5_000,
  });
  if (versionResult.code !== 0) {
    return { installed: false };
  }

  return {
    installed: true,
    version:
      parseVersion(versionResult.stdout) ?? parseVersion(versionResult.stderr),
    path: await resolveCommandPath("rtk", exec, cwd),
  };
}

export async function getRtkStatus(
  cwd: string,
  exec: ExecFileFn = defaultExecFile,
): Promise<RtkRuntimeStatus> {
  const detected = await detectRtk(cwd, exec);
  return {
    mode: readRtkMode(cwd),
    ...detected,
  };
}

export async function rewriteCommandWithRtk(
  command: string,
  cwd: string,
  exec: ExecFileFn = defaultExecFile,
): Promise<string | null> {
  const result = await exec("rtk", ["rewrite", command], {
    cwd,
    timeout: RTK_REWRITE_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    return null;
  }

  const rewritten = result.stdout.trim();
  if (rewritten.length === 0 || rewritten === command.trim()) {
    return null;
  }
  return rewritten;
}

async function commandExists(
  command: string,
  cwd: string,
  exec: ExecFileFn,
): Promise<boolean> {
  const result = await exec(command, ["--version"], { cwd, timeout: 5_000 });
  return result.code === 0;
}

export async function buildInstallPlan(
  cwd: string,
  exec: ExecFileFn = defaultExecFile,
): Promise<InstallPlan | null> {
  if (process.platform === "win32") {
    return null;
  }

  if (await commandExists("brew", cwd, exec)) {
    return {
      label: "Homebrew",
      command: "brew install rtk",
      shell: "brew",
      args: ["install", "rtk"],
    };
  }

  if (
    (await commandExists("curl", cwd, exec)) &&
    (await commandExists("sh", cwd, exec))
  ) {
    return {
      label: "official install script",
      command:
        "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
      shell: "sh",
      args: [
        "-lc",
        "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
      ],
    };
  }

  if (await commandExists("cargo", cwd, exec)) {
    return {
      label: "cargo",
      command: "cargo install --git https://github.com/rtk-ai/rtk",
      shell: "cargo",
      args: ["install", "--git", "https://github.com/rtk-ai/rtk"],
    };
  }

  return null;
}

async function runInstallPlan(
  plan: InstallPlan,
  cwd: string,
): Promise<CommandExecResult> {
  return await new Promise((resolve) => {
    const child = spawn(plan.shell, plan.args, {
      cwd,
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, RTK_INSTALL_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr: error.message, code: 1 });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function formatMode(mode: RtkMode): string {
  return mode === "auto" ? "auto" : "off";
}

function formatStatus(status: RtkRuntimeStatus): string {
  const lines = [
    `Mode: ${formatMode(status.mode)}`,
    `Installed: ${status.installed ? "yes" : "no"}`,
  ];
  if (status.version) lines.push(`Version: ${status.version}`);
  if (status.path) lines.push(`Path: ${status.path}`);
  lines.push(
    "Scope: Ged routes bash tool calls through RTK when `rtk rewrite` supports the command.",
  );
  lines.push(
    "Notes: Native Pi read/edit/write tools stay unchanged. Bash commands still fall back to their original form when RTK is unavailable or declines to rewrite.",
  );
  return lines.join("\n");
}

function formatMissingInstall(plan: InstallPlan | null): string {
  if (!plan) {
    return [
      "RTK is not installed and no supported installer was detected automatically.",
      "Install RTK manually from https://github.com/rtk-ai/rtk and then run /ged-rtk on.",
    ].join("\n");
  }

  return [
    "RTK is not installed yet.",
    `Recommended installer: ${plan.label}`,
    `Command: ${plan.command}`,
    "Run /ged-rtk install to install it and enable Ged's bash-side RTK routing.",
  ].join("\n");
}

export async function refreshRtkStatusIndicator(
  ctx: Pick<ExtensionCommandContext, "cwd" | "ui">,
  exec: ExecFileFn = defaultExecFile,
): Promise<void> {
  const detected = await detectRtk(ctx.cwd, exec);
  ctx.ui.setStatus(
    "rtk",
    formatRtkModeStatus(readRtkMode(ctx.cwd), detected.installed),
  );
}

export async function executeRtkCommand(
  args: string[] | undefined,
  ctx: ExtensionCommandContext,
  exec: ExecFileFn = defaultExecFile,
): Promise<string> {
  const [subcommand = "status"] = args ?? [];
  const cwd = ctx.cwd;

  if (subcommand === "status") {
    const status = await getRtkStatus(cwd, exec);
    if (!status.installed) {
      const plan = await buildInstallPlan(cwd, exec);
      return `${formatStatus(status)}\n\n${formatMissingInstall(plan)}`;
    }
    return formatStatus(status);
  }

  if (subcommand === "off" || subcommand === "disable") {
    saveRtkMode(cwd, "off");
    await refreshRtkStatusIndicator(ctx, exec);
    return "RTK routing is now OFF. Ged will stop rewriting bash tool calls through RTK.";
  }

  if (subcommand === "on" || subcommand === "enable") {
    const installed = await detectRtk(cwd, exec);
    if (!installed.installed) {
      const plan = await buildInstallPlan(cwd, exec);
      await refreshRtkStatusIndicator(ctx, exec);
      return formatMissingInstall(plan);
    }
    saveRtkMode(cwd, "auto");
    await refreshRtkStatusIndicator(ctx, exec);
    return `RTK routing is now ON for bash tool calls.${installed.version ? ` Detected RTK ${installed.version}.` : ""}`;
  }

  if (subcommand === "install") {
    const existing = await detectRtk(cwd, exec);
    if (existing.installed) {
      saveRtkMode(cwd, "auto");
      await refreshRtkStatusIndicator(ctx, exec);
      return `RTK is already installed${existing.version ? ` (${existing.version})` : ""}. Ged will use it for supported bash tool calls.`;
    }

    const plan = await buildInstallPlan(cwd, exec);
    if (!plan) {
      return formatMissingInstall(null);
    }

    const confirmed = ctx.hasUI
      ? await ctx.ui.confirm(
          "Install RTK?",
          `GedPi will run:\n\n${plan.command}\n\nThen it will enable RTK for supported bash tool calls.`,
        )
      : false;

    if (!confirmed) {
      return `RTK install cancelled. You can install it manually with:\n${plan.command}`;
    }

    ctx.ui.notify(`Installing RTK via ${plan.label}...`, "info");
    const installResult = await runInstallPlan(plan, cwd);
    if (installResult.code !== 0) {
      const details =
        installResult.stderr.trim() || installResult.stdout.trim();
      return [
        `RTK install failed while running: ${plan.command}`,
        details.length > 0
          ? `Installer output:\n${details}`
          : "No installer output was captured.",
      ].join("\n\n");
    }

    const installed = await detectRtk(cwd, exec);
    if (!installed.installed) {
      await refreshRtkStatusIndicator(ctx, exec);
      return [
        `RTK installer ran, but Ged still cannot find the \`rtk\` binary in PATH from ${cwd}.`,
        "Restart your shell if the installer changed PATH, then run /ged-rtk on.",
      ].join("\n\n");
    }

    saveRtkMode(cwd, "auto");
    await refreshRtkStatusIndicator(ctx, exec);
    return `Installed RTK${installed.version ? ` ${installed.version}` : ""} and enabled Ged's bash-side RTK routing.`;
  }

  return [
    `Unknown /ged-rtk subcommand: ${subcommand}`,
    "Available subcommands: status, install, on, off",
  ].join("\n");
}

export function registerRtkBashRouting(
  api: ExtensionAPI,
  exec: ExecFileFn = defaultExecFile,
): void {
  api.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (readRtkMode(ctx.cwd) !== "auto") return;

    const rewritten = await rewriteCommandWithRtk(
      event.input.command,
      ctx.cwd,
      exec,
    );
    if (!rewritten) return;

    event.input.command = rewritten;
  });
}

export function getDefaultInstallDirectory(): string {
  return path.join(os.homedir(), ".local", "bin");
}
