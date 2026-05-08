import { execFile as execFileCb } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { writeFileAtomicSync } from "./atomic.js";

const PACKAGE_NAME = "gedpi";
const CACHE_DIR = path.join(os.homedir(), ".ged");
const CACHE_PATH = path.join(CACHE_DIR, "update-cache.json");
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface UpdateCache {
  latestVersion: string;
  checkedAt: number;
  dismissedVersion?: string;
}

function readOwnVersion(): string {
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

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  writeFileAtomicSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

interface ParsedVersion {
  release: [number, number, number];
  prerelease: string | null;
}

function parseVersion(version: string): ParsedVersion | null {
  // Accept "X.Y.Z" optionally followed by a prerelease tag ("-beta.1") and/or
  // build metadata ("+sha"). Anything else is treated as unparseable so we
  // don't prompt with garbage comparisons. Build metadata is stripped — semver
  // says it must not affect precedence.
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version.trim(),
    );
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  return {
    release: [major, minor, patch],
    prerelease: match[4] ?? null,
  };
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNum = /^\d+$/u.test(a) ? Number(a) : null;
  const bNum = /^\d+$/u.test(b) ? Number(b) : null;
  // Numeric identifiers always have lower precedence than non-numeric ones.
  if (aNum !== null && bNum !== null) {
    return aNum === bNum ? 0 : aNum < bNum ? -1 : 1;
  }
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a: string | null, b: string | null): number {
  // Per semver: a release version (no prerelease) outranks any prerelease,
  // and two prereleases compare identifier-by-identifier with numeric
  // identifiers ranking lower than alphanumeric ones.
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const ap = aParts[index];
    const bp = bParts[index];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;
    const cmp = comparePrereleaseIdentifier(ap, bp);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  if (l.release[0] !== c.release[0]) return l.release[0] > c.release[0];
  if (l.release[1] !== c.release[1]) return l.release[1] > c.release[1];
  if (l.release[2] !== c.release[2]) return l.release[2] > c.release[2];
  return comparePrerelease(l.prerelease, c.prerelease) > 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function checkAndCache(): Promise<string | null> {
  const current = readOwnVersion();
  const cache = readCache();

  // If we checked recently and have a cached version, use it
  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    if (
      isNewer(cache.latestVersion, current) &&
      cache.dismissedVersion !== cache.latestVersion
    ) {
      return cache.latestVersion;
    }
    return null;
  }

  // Fetch fresh
  const latest = await fetchLatestVersion();
  if (!latest) return null;

  await writeCache({
    latestVersion: latest,
    checkedAt: Date.now(),
    dismissedVersion: cache?.dismissedVersion,
  });

  if (isNewer(latest, current) && cache?.dismissedVersion !== latest) {
    return latest;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Robust npm install                                                */
/* ------------------------------------------------------------------ */

interface NpmResult {
  code: number;
  stderr: string;
}

function execFile(
  file: string,
  args: string[],
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      file,
      args,
      { ...options, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stdout, stderr }));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

async function getGlobalNpmRoot(): Promise<string | null> {
  try {
    const { stdout } = await execFile("npm", ["root", "-g"], {
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function extractStalePath(stderr: string): string | null {
  // npm sometimes prints:  rmdir '/path/to/thing'
  const match = /rmdir ['"](.+?)['"]/u.exec(stderr);
  if (match) return match[1];
  // npm error path /path/to/thing (no quotes)
  const match2 = /^npm error path (.+)$/mu.exec(stderr);
  if (match2) return match2[1].trim();
  return null;
}

async function removeStalePath(stalePath: string): Promise<boolean> {
  try {
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function runNpmInstall(version: string): Promise<NpmResult> {
  const args = ["install", "-g", "--force", `${PACKAGE_NAME}@${version}`];

  // First attempt
  try {
    await execFile("npm", args, { timeout: 120_000 });
    return { code: 0, stderr: "" };
  } catch (err) {
    const stderr =
      (err as { stderr?: string }).stderr ?? (err as Error).message ?? "";
    const code =
      "code" in (err as Record<string, unknown>)
        ? ((err as { code: number }).code ?? 1)
        : 1;

    // If it's a stale-directory error, try to clean and retry once.
    // ENOTEMPTY/EBUSY are always directory issues.
    // EACCES is only treated as directory-related when npm mentions rmdir.
    const isStaleError =
      /ENOTEMPTY/u.test(stderr) ||
      /EBUSY/u.test(stderr) ||
      (/EACCES/u.test(stderr) && /rmdir/u.test(stderr));

    if (isStaleError) {
      const stalePath = extractStalePath(stderr);
      const globalRoot = await getGlobalNpmRoot();
      const packageRoot = globalRoot
        ? path.resolve(globalRoot, PACKAGE_NAME)
        : null;

      if (stalePath && packageRoot) {
        const target = path.resolve(stalePath);
        const isInsidePackage =
          target === packageRoot ||
          target.startsWith(`${packageRoot}${path.sep}`);
        if (isInsidePackage) {
          await removeStalePath(target);
        }
      }

      // Also try removing the top-level package dir as a fallback
      if (packageRoot) {
        await removeStalePath(packageRoot);
      }

      // Retry
      try {
        await execFile("npm", args, { timeout: 120_000 });
        return { code: 0, stderr: "" };
      } catch (retryErr) {
        const retryStderr =
          (retryErr as { stderr?: string }).stderr ??
          (retryErr as Error).message ??
          "";
        const retryCode =
          "code" in (retryErr as Record<string, unknown>)
            ? ((retryErr as { code: number }).code ?? 1)
            : 1;
        return { code: retryCode, stderr: retryStderr };
      }
    }

    return { code, stderr };
  }
}

export interface NpmErrorCategory {
  type: "permission" | "network" | "stale-directory" | "not-found" | "unknown";
  message: string;
  manualCommand?: string;
}

export function categorizeNpmError(
  stderr: string,
  version: string,
): NpmErrorCategory {
  if (/EACCES/u.test(stderr) || /permission denied/u.test(stderr)) {
    return {
      type: "permission",
      message:
        "Permission denied while installing. This usually means npm's global directory is owned by root.",
      manualCommand: `sudo npm install -g --force ${PACKAGE_NAME}@${version}`,
    };
  }
  if (/ENOTEMPTY/u.test(stderr) || /EBUSY/u.test(stderr)) {
    return {
      type: "stale-directory",
      message:
        "npm could not remove a stale directory. A manual clean-up may be required.",
      manualCommand: `sudo rm -rf "$(npm root -g)/${PACKAGE_NAME}" && sudo npm install -g --force ${PACKAGE_NAME}@${version}`,
    };
  }
  if (
    /ENOTFOUND/u.test(stderr) ||
    /ETIMEDOUT/u.test(stderr) ||
    /ECONNRESET/u.test(stderr) ||
    /ECONNREFUSED/u.test(stderr) ||
    /EAI_AGAIN/u.test(stderr) ||
    /EHOSTUNREACH/u.test(stderr) ||
    /ESOCKETTIMEDOUT/u.test(stderr) ||
    /ERR_SOCKET_TIMEOUT/u.test(stderr) ||
    /network/u.test(stderr)
  ) {
    return {
      type: "network",
      message: "Network error while reaching the npm registry.",
    };
  }
  if (
    /404/u.test(stderr) ||
    /not found/u.test(stderr) ||
    /spawn npm ENOENT|npm.*ENOENT|ENOENT.*npm/iu.test(stderr)
  ) {
    return {
      type: "not-found",
      message: "npm command not found or package version does not exist.",
    };
  }
  return {
    type: "unknown",
    message: "npm install failed with an unexpected error.",
  };
}

async function doInstall(
  version: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  ctx.ui.notify(`Installing ${PACKAGE_NAME}@${version}...`, "info");
  const result = await runNpmInstall(version);
  if (result.code === 0) {
    return true;
  }

  const category = categorizeNpmError(result.stderr, version);
  let fullMessage = `Update failed: ${category.message}`;
  if (category.manualCommand) {
    fullMessage += `\n\nYou can try running this manually:\n${category.manualCommand}`;
  }
  ctx.ui.notify(fullMessage, "error");
  return false;
}

async function promptUpdate(
  version: string,
  ctx: ExtensionContext,
): Promise<void> {
  const current = readOwnVersion();
  const updateLabel = `Update now (npm install -g ${PACKAGE_NAME}@${version})`;
  const skipLabel = "Skip";
  const dismissLabel = "Skip this version";
  const choice = await ctx.ui.select(
    `GedPi update available: ${current} → ${version}`,
    [updateLabel, skipLabel, dismissLabel],
  );

  if (choice === updateLabel) {
    const success = await doInstall(version, ctx);
    if (success) {
      const restart = await ctx.ui.confirm(
        "Restart ged?",
        "The update has been installed.",
      );
      if (restart) {
        ctx.shutdown();
      }
    }
  } else if (choice === dismissLabel) {
    const cache = readCache();
    if (cache) {
      await writeCache({ ...cache, dismissedVersion: version });
    }
    ctx.ui.notify(`Skipped version ${version}`, "info");
  }
}

export function registerUpdater(api: ExtensionAPI): void {
  api.on("session_start", async (_event, ctx) => {
    const newVersion = await checkAndCache();
    if (newVersion) {
      await promptUpdate(newVersion, ctx);
    }
  });

  api.registerCommand("update", {
    description: "Check for GedPi updates",
    async handler(_args, ctx) {
      ctx.ui.notify("Checking for updates...", "info");
      // Force a fresh check
      const latest = await fetchLatestVersion();
      if (!latest) {
        ctx.ui.notify("Could not reach npm registry", "error");
        return;
      }
      const current = readOwnVersion();
      if (isNewer(latest, current)) {
        await promptUpdate(latest, ctx);
      } else {
        ctx.ui.notify(`GedPi ${current} is up to date`, "info");
      }
    },
  });
}
