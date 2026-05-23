import { EventEmitter } from "node:events";
import { describe, expect, type Mock, test, vi } from "vitest";

import {
  buildGlimpsePlanReviewHtml,
  importPlannotatorServer,
  requestGlimpsePlanReview,
} from "../src/plan-review.js";

describe("Glimpse plan review", () => {
  test("imports Plannotator's TypeScript server module through the production helper", async () => {
    const server = await importPlannotatorServer();

    expect(server.startPlanReviewServer).toEqual(expect.any(Function));
  });

  test("renders a full Plannotator iframe wrapper with browser fallback", () => {
    const html = buildGlimpsePlanReviewHtml(
      "http://127.0.0.1:48123/?token=<unsafe>",
    );

    expect(html).toContain("Full Plannotator plan review");
    expect(html).toContain("<iframe");
    expect(html).toContain("Use browser fallback");
    expect(html).toContain("Open in browser");
    expect(html).toContain("http://127.0.0.1:48123/?token=&lt;unsafe&gt;");
    expect(html).not.toContain("token=<unsafe>");
  });

  test("does not render raw plan markdown or the old approval dialog", () => {
    const html = buildGlimpsePlanReviewHtml("http://127.0.0.1:48123/");

    expect(html).not.toContain("Approve plan");
    expect(html).not.toContain("Deny / request changes");
    expect(html).not.toContain("Feedback / notes");
    expect(html).not.toContain("<pre>");
  });

  test("closes the Glimpse window when the embedded review returns a decision", async () => {
    const window = new EventEmitter() as EventEmitter & {
      close: Mock;
    };
    window.close = vi.fn();
    const stop = vi.fn();

    const decision = await requestGlimpsePlanReview("plan", {
      importGlimpse: async () => ({
        open: () => window,
      }),
      startServer: async () => ({
        reviewId: "review-1",
        url: "http://127.0.0.1:48123/",
        waitForDecision: async () => ({
          approved: true,
          feedback: " looks good ",
        }),
        stop,
      }),
    });

    expect(decision).toEqual({
      approved: true,
      feedback: "looks good",
      savedPath: undefined,
      agentSwitch: undefined,
      permissionMode: undefined,
    });
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  test("returns null for Glimpse browser fallback messages", async () => {
    const window = new EventEmitter() as EventEmitter & {
      close: Mock;
    };
    window.close = vi.fn();

    const decision = requestGlimpsePlanReview("plan", {
      importGlimpse: async () => ({
        open: () => {
          setTimeout(() => window.emit("message", { fallback: true }), 0);
          return window;
        },
      }),
      startServer: async () => ({
        reviewId: "review-1",
        url: "http://127.0.0.1:48123/",
        waitForDecision: () => new Promise(() => {}),
        stop: vi.fn(),
      }),
    });

    await expect(decision).resolves.toBeNull();
    expect(window.close).toHaveBeenCalledTimes(1);
  });
});
