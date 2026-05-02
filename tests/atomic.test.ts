import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { writeFileAtomic, writeFileAtomicSync } from "../src/atomic.js";

async function tempFile(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(dir, "state.json");
}

function modeBits(mode: number): number {
  return mode & 0o777;
}

describe("atomic writes", () => {
  test("async writes preserve existing file permissions", async () => {
    const filePath = await tempFile("ged-atomic-async-");
    await writeFile(filePath, "old\n", "utf8");
    await chmod(filePath, 0o600);

    await writeFileAtomic(filePath, "new\n");

    expect(modeBits((await stat(filePath)).mode)).toBe(0o600);
  });

  test("sync writes preserve existing file permissions", async () => {
    const filePath = await tempFile("ged-atomic-sync-");
    await writeFile(filePath, "old\n", "utf8");
    await chmod(filePath, 0o600);

    writeFileAtomicSync(filePath, "new\n");

    expect(modeBits((await stat(filePath)).mode)).toBe(0o600);
  });
});
