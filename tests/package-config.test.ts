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

  test("latest scoped Pi review dependencies are configured", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      overrides?: Record<string, string>;
      engines?: Record<string, string>;
    };

    expect(packageJson.engines?.node).toBe(">=22.19.0");
    expect(packageJson.dependencies?.["@earendil-works/pi-coding-agent"]).toBe(
      "0.75.3",
    );
    expect(packageJson.overrides?.["@earendil-works/pi-tui"]).toBe("0.75.3");
    expect(packageJson.dependencies?.["@plannotator/pi-extension"]).toBe(
      "0.19.18",
    );
    expect(packageJson.dependencies?.glimpseui).toBe("0.8.1");
  });

  test("Plannotator extension and skills are bundled by default", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      pi?: { extensions?: string[]; skills?: string[] };
      dependencies?: Record<string, unknown>;
    };

    expect(packageJson.dependencies).toHaveProperty(
      "@plannotator/pi-extension",
    );
    expect(packageJson.pi?.extensions ?? []).toContain(
      "./node_modules/@plannotator/pi-extension/index.ts",
    );
    expect(packageJson.pi?.skills ?? []).toContain(
      "./node_modules/@plannotator/pi-extension/skills",
    );
  });
});
