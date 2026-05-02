import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { ensureBundledPromptTemplates } from "../src/prompt-template-sync.js";

describe("ensureBundledPromptTemplates", () => {
  test("copies managed prompt templates into the global prompt directory", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ged-prompt-sync-"));
    const sourceDir = path.join(root, "source-prompts");
    const homeDir = path.join(root, "home");

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "commit.md"), "commit prompt\n", "utf8");
    writeFileSync(path.join(sourceDir, "push.md"), "push prompt\n", "utf8");

    const written = ensureBundledPromptTemplates(sourceDir, { homeDir });
    const targetDir = path.join(homeDir, ".pi", "agent", "prompts", "gedpi");

    expect(written).toEqual([
      path.join(targetDir, "commit.md"),
      path.join(targetDir, "push.md"),
    ]);
    expect(readFileSync(path.join(targetDir, "commit.md"), "utf8")).toBe(
      "commit prompt\n",
    );
    expect(readFileSync(path.join(targetDir, "push.md"), "utf8")).toBe(
      "push prompt\n",
    );
  });

  test("skips unchanged prompts and rewrites changed managed prompts", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ged-prompt-sync-"));
    const sourceDir = path.join(root, "source-prompts");
    const homeDir = path.join(root, "home");
    const targetDir = path.join(homeDir, ".pi", "agent", "prompts", "gedpi");

    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "commit.md"), "new commit\n", "utf8");
    writeFileSync(path.join(sourceDir, "push.md"), "same push\n", "utf8");
    writeFileSync(path.join(targetDir, "commit.md"), "old commit\n", "utf8");
    writeFileSync(path.join(targetDir, "push.md"), "same push\n", "utf8");

    const written = ensureBundledPromptTemplates(sourceDir, { homeDir });

    expect(written).toEqual([path.join(targetDir, "commit.md")]);
    expect(readFileSync(path.join(targetDir, "commit.md"), "utf8")).toBe(
      "new commit\n",
    );
    expect(readFileSync(path.join(targetDir, "push.md"), "utf8")).toBe(
      "same push\n",
    );
  });

  test("removes the legacy managed prompt directory", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ged-prompt-sync-"));
    const sourceDir = path.join(root, "source-prompts");
    const homeDir = path.join(root, "home");
    const legacyDir = path.join(homeDir, ".pi", "agent", "prompts", "zz-gedpi");
    const targetDir = path.join(homeDir, ".pi", "agent", "prompts", "gedpi");

    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "commit.md"), "commit prompt\n", "utf8");
    writeFileSync(path.join(sourceDir, "push.md"), "push prompt\n", "utf8");
    writeFileSync(path.join(legacyDir, "push.md"), "legacy prompt\n", "utf8");

    ensureBundledPromptTemplates(sourceDir, { homeDir });

    expect(existsSync(legacyDir)).toBe(false);
    expect(readFileSync(path.join(targetDir, "push.md"), "utf8")).toBe(
      "push prompt\n",
    );
  });
});
