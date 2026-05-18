import { describe, expect, test } from "vitest";

import { buildGlimpsePlanReviewHtml } from "../src/plan-review.js";

describe("Glimpse plan review", () => {
  test("renders escaped plan content with approval actions", () => {
    const html = buildGlimpsePlanReviewHtml(
      "# Plan\n\n<script>alert('x')</script>",
    );

    expect(html).toContain("Review GedPi plan");
    expect(html).toContain("Approve plan");
    expect(html).toContain("Deny / request changes");
    expect(html).toContain("Use browser fallback");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert('x')</script>");
  });
});
