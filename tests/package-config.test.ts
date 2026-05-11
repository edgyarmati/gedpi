import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

describe("package Pi configuration", () => {
  test("does not depend on pi-extension-settings", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      pi?: { extensions?: string[] };
      dependencies?: Record<string, unknown>;
    };
    const extensions = packageJson.pi?.extensions ?? [];

    const hasPiExtensionSettings = extensions.some((extension) =>
      extension.includes("pi-extension-settings"),
    );
    expect(hasPiExtensionSettings).toBe(false);

    const deps = packageJson.dependencies ?? {};
    expect(deps).not.toHaveProperty("@juanibiapina/pi-extension-settings");
  });

  test("ged-core extension is registered", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { pi?: { extensions?: string[] } };
    const extensions = packageJson.pi?.extensions ?? [];

    const gedCoreIndex = extensions.indexOf("./extensions/ged-core/index.ts");
    expect(gedCoreIndex).toBeGreaterThanOrEqual(0);
  });
});
