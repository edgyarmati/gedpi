import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

describe("GedPi theme packaging", () => {
  const requiredThemeTokens = [
    "accent",
    "border",
    "borderAccent",
    "borderMuted",
    "success",
    "error",
    "warning",
    "muted",
    "dim",
    "text",
    "thinkingText",
    "selectedBg",
    "userMessageBg",
    "userMessageText",
    "customMessageBg",
    "customMessageText",
    "customMessageLabel",
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
    "toolTitle",
    "toolOutput",
    "mdHeading",
    "mdLink",
    "mdLinkUrl",
    "mdCode",
    "mdCodeBlock",
    "mdCodeBlockBorder",
    "mdQuote",
    "mdQuoteBorder",
    "mdHr",
    "mdListBullet",
    "toolDiffAdded",
    "toolDiffRemoved",
    "toolDiffContext",
    "syntaxComment",
    "syntaxKeyword",
    "syntaxFunction",
    "syntaxVariable",
    "syntaxString",
    "syntaxNumber",
    "syntaxType",
    "syntaxOperator",
    "syntaxPunctuation",
    "thinkingOff",
    "thinkingMinimal",
    "thinkingLow",
    "thinkingMedium",
    "thinkingHigh",
    "thinkingXhigh",
    "bashMode",
  ];

  test("bundles only the Ghostlight GedPi theme", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      files?: string[];
      pi?: { extensions?: string[]; skills?: string[]; themes?: string[] };
    };

    expect(packageJson.files ?? []).toContain("themes");
    expect(packageJson.pi?.themes).toEqual(["./themes"]);
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("amp-themes");
    await expect(
      access(path.join(process.cwd(), "themes")),
    ).resolves.toBeUndefined();

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

  test("ghostlight theme defines every required token", async () => {
    const themePath = path.join(process.cwd(), "themes", "ghostlight.json");
    const theme = JSON.parse(await readFile(themePath, "utf8")) as {
      name?: string;
      colors?: Record<string, unknown>;
    };

    expect(theme.name).toBe("ghostlight");
    expect(Object.keys(theme.colors ?? {}).sort()).toEqual(
      [...requiredThemeTokens].sort(),
    );
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

  test("registers native Pi UI replacement hooks only in the GedPi shell skin", async () => {
    const searchableRoots = ["src", "extensions", "vendor"];
    const forbiddenPatterns = [
      "setEditorComponent",
      "setFooter",
      "setWorkingIndicator",
      "setWorkingVisible",
      "UserMessageComponent.prototype.render",
    ];
    const allowedHookFile = path.join(
      "extensions",
      "ged-core",
      "ghostlight-ui.ts",
    );

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
        if (
          fileName === allowedHookFile &&
          ["setEditorComponent", "setFooter", "setWorkingIndicator"].includes(
            pattern,
          )
        ) {
          continue;
        }
        expect(content, `${fileName} should not call ${pattern}`).not.toContain(
          pattern,
        );
      }
    }

    const shellSkin = await readFile(
      path.join(process.cwd(), allowedHookFile),
      "utf8",
    );
    expect(shellSkin).toContain("git");
    expect(shellSkin).toContain("branch");
    expect(shellSkin).toContain("class EmptyFooter");
    expect(shellSkin).toContain('const topRight = theme.fg("muted"');
    expect(shellSkin).toContain("this.api.getThinkingLevel()");
    expect(shellSkin).toContain("diff");
    expect(shellSkin).toContain("HEAD");
    expect(shellSkin).toContain("--numstat");
    expect(shellSkin).toContain("ls-files");
    expect(shellSkin).toContain("--others");
    expect(shellSkin).toContain("tool_execution_end");
    expect(shellSkin).toContain("formatDiffSummary");
    expect(shellSkin).toContain('bottomRightParts.join(" · ")');
    expect(shellSkin).toContain("formatContext(this.ctx)");
    expect(shellSkin).toContain("formatCost(this.ctx)");
    expect(shellSkin).not.toContain("ghostlight-ready");
    expect(shellSkin).not.toContain(".ged workflow");
    expect(shellSkin).not.toContain("formatModel");
    expect(shellSkin).not.toContain("getExtensionStatuses");
    expect(shellSkin).not.toContain("onBranchChange");
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
