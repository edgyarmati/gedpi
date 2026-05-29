import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

describe("GedPi theme packaging", () => {
  test("does not bundle custom themes", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      files?: string[];
      pi?: { extensions?: string[]; skills?: string[]; themes?: string[] };
    };

    expect(packageJson.files ?? []).not.toContain("themes");
    expect(packageJson.pi).not.toHaveProperty("themes");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("amp-themes");

    const packageSurface = [
      ...(packageJson.pi?.extensions ?? []),
      ...(packageJson.pi?.skills ?? []),
      ...(packageJson.pi?.themes ?? []),
    ];
    expect(packageSurface).not.toContain(expect.stringContaining("amp-themes"));
    expect(packageSurface).not.toContain(
      expect.stringContaining("pi-tool-display"),
    );
  });

  test("removed theme directory is absent", async () => {
    await expect(access(path.join(process.cwd(), "themes"))).rejects.toThrow();
  });

  test("preserves non-theme Amp-style input and message UI", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { files?: string[]; pi?: { extensions?: string[] } };

    expect(packageJson.files ?? []).toEqual(
      expect.arrayContaining([
        "vendor/amp-editor.ts",
        "vendor/amp-command-palette.ts",
        "vendor/amp-user-message.ts",
      ]),
    );
    expect(packageJson.pi?.extensions ?? []).toEqual(
      expect.arrayContaining([
        "./vendor/amp-editor.ts",
        "./vendor/amp-user-message.ts",
      ]),
    );

    await Promise.all(
      [
        "vendor/amp-editor.ts",
        "vendor/amp-command-palette.ts",
        "vendor/amp-user-message.ts",
      ].map((fileName) => access(path.join(process.cwd(), fileName))),
    );
  });

  test("package files do not reference removed bundled theme names", async () => {
    const removedThemeNames = [
      "amp-dark",
      "amp-gruvbox-dark-hard",
      "amp-light",
      "midnight",
    ];
    const filesToCheck = [
      "package.json",
      "README.md",
      "AGENTS.md",
      "CREDITS.md",
    ];

    for (const fileName of filesToCheck) {
      const content = await readFile(
        path.join(process.cwd(), fileName),
        "utf8",
      );
      for (const themeName of removedThemeNames) {
        expect(
          content,
          `${fileName} should not mention ${themeName}`,
        ).not.toContain(themeName);
      }
    }
  });

  test("no stray theme JSON files remain at the package root", async () => {
    const rootFiles = await readdir(process.cwd());
    expect(
      rootFiles.filter((fileName) => fileName.endsWith(".json")),
    ).not.toEqual(
      expect.arrayContaining([
        "amp-dark.json",
        "amp-gruvbox-dark-hard.json",
        "amp-light.json",
        "midnight.json",
      ]),
    );
  });
});
