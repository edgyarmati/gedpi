import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const REQUIRED_COLOR_TOKENS = [
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
].sort();

const MIDNIGHT_VARS = [
  "amp-bg",
  "amp-bg-deep",
  "amp-surface",
  "amp-surface-soft",
  "amp-border",
  "amp-border-soft",
  "amp-text",
  "amp-text-soft",
  "amp-muted",
  "amp-dim",
  "amp-accent",
  "amp-accent-strong",
  "amp-cyan",
  "amp-blue",
  "amp-orange",
  "amp-yellow",
  "amp-red",
  "amp-purple",
].sort();

const EXPECTED_THEME_FILES = [
  "amp-dark.json",
  "amp-gruvbox-dark-hard.json",
  "amp-light.json",
  "midnight.json",
].sort();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Theme = {
  name?: string;
  vars?: Record<string, string>;
  colors?: Record<string, string>;
  export?: Record<string, string>;
};

async function readTheme(fileName: string): Promise<Theme> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "themes", fileName), "utf8"),
  ) as Theme;
}

async function readLocalThemes(): Promise<
  Array<{ fileName: string; theme: Theme }>
> {
  const fileNames = (await readdir(path.join(process.cwd(), "themes")))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      theme: await readTheme(fileName),
    })),
  );
}

function resolveColor(theme: Theme, value: string | undefined): string {
  if (!value) {
    throw new Error("Missing color value");
  }

  if (HEX_COLOR.test(value)) {
    return value;
  }

  const variableValue = theme.vars?.[value];
  if (variableValue && HEX_COLOR.test(variableValue)) {
    return variableValue;
  }

  throw new Error(`Unknown or invalid color reference: ${value}`);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.slice(1);
  const [red, green, blue] = [0, 2, 4]
    .map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
    .map((channel) => {
      const scaled = channel / 255;
      return scaled <= 0.03928
        ? scaled / 12.92
        : ((scaled + 0.055) / 1.055) ** 2.4;
    });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const [lighter, darker] = [foregroundLuminance, backgroundLuminance].sort(
    (left, right) => right - left,
  );

  return (lighter + 0.05) / (darker + 0.05);
}

describe("GedPi themes", () => {
  test("bundles local themes without amp-themes", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      files?: string[];
      pi?: { extensions?: string[]; skills?: string[]; themes?: string[] };
    };

    expect(packageJson.files ?? []).toContain("themes");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("amp-themes");
    expect(packageJson.pi?.themes ?? []).toEqual(["./themes"]);
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

  test("bundles the expected local theme files", async () => {
    const fileNames = (await readdir(path.join(process.cwd(), "themes")))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();

    expect(fileNames).toEqual(EXPECTED_THEME_FILES);
  });

  test("first-run default theme resolves to a local theme", async () => {
    const theme = await readTheme("amp-gruvbox-dark-hard.json");

    expect(theme.name).toBe("amp-gruvbox-dark-hard");
  });

  test("local themes are complete Pi themes with valid color references", async () => {
    const themes = await readLocalThemes();

    for (const { fileName, theme } of themes) {
      expect(theme.name, `${fileName} should declare a name`).toBeTruthy();
      expect(Object.keys(theme.colors ?? {}).sort()).toEqual(
        REQUIRED_COLOR_TOKENS,
      );
      expect(Object.values(theme.colors ?? {})).not.toContain("");

      for (const [name, value] of Object.entries(theme.vars ?? {})) {
        expect(value, `${fileName} var ${name} should be a hex color`).toMatch(
          HEX_COLOR,
        );
      }

      for (const [name, value] of Object.entries(theme.colors ?? {})) {
        expect(
          () => resolveColor(theme, value),
          `${fileName} color ${name} should resolve to a hex color`,
        ).not.toThrow();
      }

      for (const [name, value] of Object.entries(theme.export ?? {})) {
        expect(
          () => resolveColor(theme, value),
          `${fileName} export color ${name} should resolve to a hex color`,
        ).not.toThrow();
      }
    }
  });

  test("midnight keeps the expected Amp-compatible token aliases", async () => {
    const theme = await readTheme("midnight.json");

    expect(theme.name).toBe("midnight");
    expect(Object.keys(theme.vars ?? {}).sort()).toEqual(MIDNIGHT_VARS);
    expect(theme.colors?.accent).toBe("amp-accent");
    expect(theme.colors?.userMessageBg).toBe("amp-bg");
    expect(theme.colors?.customMessageBg).toBe("amp-bg");
    expect(theme.colors?.toolDiffContext).toBe("amp-muted");
  });

  test("midnight keeps a readable low-glare hierarchy", async () => {
    const theme = await readTheme("midnight.json");
    const background = resolveColor(theme, theme.vars?.["amp-bg"]);
    const text = resolveColor(theme, theme.colors?.text);
    const muted = resolveColor(theme, theme.colors?.muted);
    const dim = resolveColor(theme, theme.colors?.dim);
    const diffContext = resolveColor(theme, theme.colors?.toolDiffContext);

    const textContrast = contrastRatio(text, background);
    const mutedContrast = contrastRatio(muted, background);
    const dimContrast = contrastRatio(dim, background);
    const diffContextContrast = contrastRatio(diffContext, background);

    expect(textContrast).toBeGreaterThanOrEqual(7);
    expect(mutedContrast).toBeGreaterThanOrEqual(4.5);
    expect(dimContrast).toBeGreaterThanOrEqual(3);
    expect(dimContrast).toBeLessThan(mutedContrast);
    expect(mutedContrast).toBeLessThan(textContrast);
    expect(diffContextContrast).toBeLessThan(textContrast);
  });

  test("midnight tool states are distinct and readable", async () => {
    const theme = await readTheme("midnight.json");
    const toolBackgrounds = [
      resolveColor(theme, theme.colors?.toolPendingBg),
      resolveColor(theme, theme.colors?.toolSuccessBg),
      resolveColor(theme, theme.colors?.toolErrorBg),
    ];
    const toolTitle = resolveColor(theme, theme.colors?.toolTitle);
    const toolOutput = resolveColor(theme, theme.colors?.toolOutput);

    expect(new Set(toolBackgrounds).size).toBe(toolBackgrounds.length);

    for (const background of toolBackgrounds) {
      expect(contrastRatio(toolTitle, background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(toolOutput, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
