#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

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

export function getGedpiVersion() {
  const pkgPath = path.join(getGedPackageDir(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.version ?? "0.0.0";
}

function findNearestPackageJson(startDir) {
  let currentDir = startDir;
  while (true) {
    const packagePath = path.join(currentDir, "package.json");
    if (existsSync(packagePath)) {
      return packagePath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export function resolvePiCliPath() {
  let currentDir = getGedPackageDir();
  while (true) {
    const cliPath = path.join(
      currentDir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "cli.js",
    );

    if (existsSync(cliPath)) {
      return cliPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  const mainPath = require.resolve("@earendil-works/pi-coding-agent");
  return path.join(path.dirname(mainPath), "cli.js");
}

export function getBundledPiVersion() {
  const cliPath = resolvePiCliPath();
  const packagePath = findNearestPackageJson(path.dirname(cliPath));
  if (!packagePath) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
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

function readAgentSettings(agentDir) {
  const settingsFile = path.join(agentDir, "settings.json");
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;

    return code === "ENOENT" ? {} : null;
  }
}

function writeAgentSettings(agentDir, settings) {
  mkdirSync(agentDir, { recursive: true });
  writeFileAtomicSync(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

export function ensureQuietStartupDefault(baseEnv = process.env) {
  const agentDir = resolveAgentDir(baseEnv);
  const settings = readAgentSettings(agentDir);
  if (!settings || settings.quietStartup !== undefined) {
    return;
  }

  writeAgentSettings(agentDir, { ...settings, quietStartup: true });
}

export function suppressBundledPiChangelog(baseEnv = process.env) {
  const piVersion = getBundledPiVersion();
  if (!piVersion) {
    return;
  }

  const agentDir = resolveAgentDir(baseEnv);
  const settings = readAgentSettings(agentDir);
  if (!settings || settings.lastChangelogVersion === piVersion) {
    return;
  }

  writeAgentSettings(agentDir, {
    ...settings,
    lastChangelogVersion: piVersion,
  });
}

const REMOVED_BUNDLED_THEMES = new Set([
  "amp-dark",
  "amp-gruvbox-dark-hard",
  "amp-light",
  "midnight",
]);

export function clearRemovedBundledTheme(baseEnv = process.env) {
  const agentDir = resolveAgentDir(baseEnv);
  const settings = readAgentSettings(agentDir);
  if (!settings || !REMOVED_BUNDLED_THEMES.has(settings.theme)) {
    return;
  }

  const { theme: _theme, ...rest } = settings;
  writeAgentSettings(agentDir, rest);
}

export function ensureGhostlightDefaultTheme(baseEnv = process.env) {
  const agentDir = resolveAgentDir(baseEnv);
  const settings = readAgentSettings(agentDir);
  if (!settings || settings.theme !== undefined) {
    return;
  }

  writeAgentSettings(agentDir, { ...settings, theme: "ghostlight" });
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
  clearRemovedBundledTheme(options.env);
  ensureGhostlightDefaultTheme(options.env);
  suppressBundledPiChangelog(options.env);
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
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    console.log(getGedpiVersion());
    process.exit(0);
  }
  runGed(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
