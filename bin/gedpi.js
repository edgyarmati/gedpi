#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function writeFileAtomicSync(filePath, content) {
  const tempPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  let mode;
  try {
    mode = statSync(filePath).mode & 0o777;
  } catch {
    // New file: keep Node's default creation mode.
  }
  try {
    writeFileSync(tempPath, content, "utf8");
    if (mode !== undefined) {
      chmodSync(tempPath, mode);
    }
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp may not exist
    }
    throw error;
  }
}

export function getGedPackageDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolvePiCliPath() {
  return path.join(
    getGedPackageDir(),
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
}

export function buildGedEnvironment(baseEnv = process.env) {
  // Pi has its own update prompt; GedPi runs its own (registerUpdater).
  // Suppress Pi's check at the launcher boundary so the Ged updater is
  // the only one that surfaces upgrade prompts.
  return {
    ...baseEnv,
    PI_SKIP_VERSION_CHECK: "1",
  };
}

function resolveAgentDir(baseEnv = process.env) {
  const envDir = baseEnv.PI_CODING_AGENT_DIR;
  if (!envDir) {
    return path.join(os.homedir(), ".pi", "agent");
  }

  if (envDir === "~") {
    return os.homedir();
  }

  if (envDir.startsWith("~/")) {
    return path.join(os.homedir(), envDir.slice(2));
  }

  return envDir;
}

export function ensureQuietStartupDefault(baseEnv = process.env) {
  const agentDir = resolveAgentDir(baseEnv);
  const settingsFile = path.join(agentDir, "settings.json");

  try {
    const raw = readFileSync(settingsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.quietStartup === undefined
    ) {
      writeFileAtomicSync(
        settingsFile,
        `${JSON.stringify({ ...parsed, quietStartup: true }, null, 2)}\n`,
      );
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;

    if (code !== "ENOENT") {
      return;
    }

    mkdirSync(agentDir, { recursive: true });
    writeFileAtomicSync(
      settingsFile,
      `${JSON.stringify({ quietStartup: true }, null, 2)}\n`,
    );
  }
}

export function buildPiProcessSpec(
  argv = process.argv.slice(2),
  baseEnv = process.env,
) {
  return {
    command: process.execPath,
    args: [resolvePiCliPath(), "-e", getGedPackageDir(), ...argv],
    env: buildGedEnvironment(baseEnv),
  };
}

export async function runGed(argv = process.argv.slice(2), options = {}) {
  ensureQuietStartupDefault(options.env);
  const spec = buildPiProcessSpec(argv, options.env);

  return await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd ?? process.cwd(),
      env: spec.env,
      stdio: "inherit",
    });

    const forwardSignal = (sig) => child.kill(sig);
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);

      if (signal) {
        reject(new Error(`ged terminated with signal ${signal}`));
        return;
      }

      process.exitCode = code ?? 0;
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      reject(err);
    });
  });
}

export function isGedEntrypointInvocation(
  argvPath = process.argv[1],
  moduleUrl = import.meta.url,
) {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return path.resolve(argvPath) === fileURLToPath(moduleUrl);
  }
}

if (isGedEntrypointInvocation()) {
  runGed().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
