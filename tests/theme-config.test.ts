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

  test("does not bundle Amp-style input and message UI overrides", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { files?: string[]; pi?: { extensions?: string[] } };

    for (const fileName of [
      "vendor/amp-editor.ts",
      "vendor/amp-command-palette.ts",
      "vendor/amp-user-message.ts",
    ]) {
      expect(packageJson.files ?? []).not.toContain(fileName);
    }
    for (const extensionPath of [
      "./vendor/amp-editor.ts",
      "./vendor/amp-user-message.ts",
    ]) {
      expect(packageJson.pi?.extensions ?? []).not.toContain(extensionPath);
    }

    await Promise.all(
      [
        "vendor/amp-editor.ts",
        "vendor/amp-command-palette.ts",
        "vendor/amp-user-message.ts",
      ].map((fileName) =>
        expect(access(path.join(process.cwd(), fileName))).rejects.toThrow(),
      ),
    );
  });

  test("does not register native Pi UI replacement hooks", async () => {
    const searchableRoots = ["src", "extensions", "vendor"];
    const forbiddenPatterns = [
      "setEditorComponent",
      "setFooter",
      "setWorkingVisible",
      "UserMessageComponent.prototype.render",
    ];

    async function collectFiles(dir: string): Promise<string[]> {
      const entries = await readdir(path.join(process.cwd(), dir), {
        withFileTypes: true,
      });
      const files = await Promise.all(
        entries.map((entry) => {
          const relativePath = path.join(dir, entry.name);
          return entry.isDirectory()
            ? collectFiles(relativePath)
            : relativePath;
        }),
      );
      return files.flat();
    }

    const files = (await Promise.all(searchableRoots.map(collectFiles)))
      .flat()
      .filter((fileName) => /\.[cm]?[tj]s$/.test(fileName));
    const contents = await Promise.all(
      files.map(async (fileName) => ({
        fileName,
        content: await readFile(path.join(process.cwd(), fileName), "utf8"),
      })),
    );

    for (const { fileName, content } of contents) {
      for (const pattern of forbiddenPatterns) {
        expect(content, `${fileName} should not call ${pattern}`).not.toContain(
          pattern,
        );
      }
    }
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
