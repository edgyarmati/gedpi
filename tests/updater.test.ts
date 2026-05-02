import { describe, expect, test } from "vitest";

import { isNewer } from "../src/updater.js";

describe("updater.isNewer", () => {
  test("returns true when latest beats current on each segment", () => {
    expect(isNewer("0.11.0", "0.10.5")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.10.6", "0.10.5")).toBe(true);
  });

  test("returns false when latest is equal or older", () => {
    expect(isNewer("0.10.5", "0.10.5")).toBe(false);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
    expect(isNewer("0.10.4", "0.10.5")).toBe(false);
  });

  test("treats prereleases as lower precedence than the matching release", () => {
    // A prerelease tag with otherwise-larger numbers still counts as newer.
    expect(isNewer("0.11.0-beta.1", "0.10.5")).toBe(true);
    // Build metadata never affects precedence.
    expect(isNewer("0.11.0+sha", "0.11.0")).toBe(false);
    // The release version outranks any prerelease of the same X.Y.Z.
    expect(isNewer("0.11.0", "0.11.0-beta.1")).toBe(true);
    expect(isNewer("0.11.0-beta.1", "0.11.0")).toBe(false);
  });

  test("orders prerelease tags by semver identifier rules", () => {
    // Alphabetical comparison on alphanumeric identifiers.
    expect(isNewer("0.11.0-beta.1", "0.11.0-alpha.1")).toBe(true);
    expect(isNewer("0.11.0-alpha.1", "0.11.0-beta.1")).toBe(false);
    // Numeric identifier ordering.
    expect(isNewer("0.11.0-beta.10", "0.11.0-beta.2")).toBe(true);
    // A prerelease with more identifiers outranks a shorter prefix.
    expect(isNewer("0.11.0-beta.1.0", "0.11.0-beta.1")).toBe(true);
    // Equal prereleases are not newer.
    expect(isNewer("0.11.0-beta.1", "0.11.0-beta.1")).toBe(false);
  });

  test("returns false for unparseable versions instead of crashing", () => {
    expect(isNewer("not-a-version", "0.10.5")).toBe(false);
    expect(isNewer("0.10", "0.10.5")).toBe(false);
    expect(isNewer("0.10.5", "")).toBe(false);
    expect(isNewer("", "")).toBe(false);
  });
});
