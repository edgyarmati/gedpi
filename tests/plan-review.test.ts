import { describe, expect, test } from "vitest";

import {
  buildGlimpsePlanReviewHtml,
  importPlannotatorServer,
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
});
