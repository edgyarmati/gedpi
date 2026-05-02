import { describe, expect, it } from "vitest";

import { parseTaskRow } from "../src/tasks.js";

describe("parseTaskRow", () => {
  it("parses a basic six-column row", () => {
    const row = "| T1 | Build feature | - | todo | - | - |";
    const task = parseTaskRow(row);
    expect(task).not.toBeNull();
    expect(task?.id).toBe("T1");
    expect(task?.title).toBe("Build feature");
    expect(task?.dependsOn).toEqual([]);
    expect(task?.status).toBe("todo");
    expect(task?.doneCriteria).toEqual([]);
    expect(task?.skills).toEqual([]);
  });

  it("treats pipes inside backtick code spans as literal characters", () => {
    const row = "| T2 | Parse `a | b` tokens | T1 | todo | tests pass | foo |";
    const task = parseTaskRow(row);
    expect(task).not.toBeNull();
    expect(task?.id).toBe("T2");
    expect(task?.title).toBe("Parse `a | b` tokens");
    expect(task?.dependsOn).toEqual(["T1"]);
    expect(task?.doneCriteria).toEqual(["tests pass"]);
    expect(task?.skills).toEqual(["foo"]);
  });

  it("still treats escaped pipes as literal characters", () => {
    const row = "| T3 | Title with \\| pipe | - | todo | - | - |";
    const task = parseTaskRow(row);
    expect(task).not.toBeNull();
    expect(task?.title).toBe("Title with | pipe");
  });

  it("supports multiple code spans within a single cell", () => {
    const row =
      "| T4 | Run `cmd | flag` and `other | flag` | - | todo | - | - |";
    const task = parseTaskRow(row);
    expect(task).not.toBeNull();
    expect(task?.title).toBe("Run `cmd | flag` and `other | flag`");
  });

  it("returns null when the column count is wrong", () => {
    expect(parseTaskRow("| T5 | only three | columns |")).toBeNull();
  });

  it("parses dependsOn, doneCriteria, and skills lists", () => {
    const row =
      "| T6 | Implement | T1, T2 | doing | tests; lint | typescript, vitest |";
    const task = parseTaskRow(row);
    expect(task?.dependsOn).toEqual(["T1", "T2"]);
    expect(task?.status).toBe("doing");
    expect(task?.doneCriteria).toEqual(["tests", "lint"]);
    expect(task?.skills).toEqual(["typescript", "vitest"]);
  });
});
