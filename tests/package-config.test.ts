import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

describe("package Pi configuration", () => {
  test("loads pi-extension-settings before ged-core so settings registration is visible", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { pi?: { extensions?: string[] } };
    const extensions = packageJson.pi?.extensions ?? [];

    const settingsIndex = extensions.findIndex((extension) =>
      extension.includes("pi-extension-settings"),
    );
    const gedCoreIndex = extensions.indexOf("./extensions/ged-core/index.ts");

    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(gedCoreIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeLessThan(gedCoreIndex);
  });
});
