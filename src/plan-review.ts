import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const PLANNOTATOR_REVIEW_RESULT_CHANNEL = "plannotator:review-result";

interface PlanReviewResult {
  approved: boolean;
  feedback?: string;
  savedPath?: string;
  agentSwitch?: string;
  permissionMode?: string;
}

interface PlannotatorResponse<T> {
  status: "handled" | "unavailable" | "error";
  result?: T;
  error?: string;
}

interface GlimpsePromptResult {
  approved?: boolean;
  feedback?: string;
}

interface GlimpseModule {
  prompt: (
    html: string,
    options: {
      width: number;
      height: number;
      title: string;
      floating?: boolean;
      openLinks?: boolean;
    },
  ) => Promise<GlimpsePromptResult | null>;
}

export function registerPlanReviewTool(api: ExtensionAPI): void {
  api.registerTool({
    name: "gedpi_plan_review",
    label: "Review Plan",
    description:
      "Open the GedPi draft plan for visual review, preferring native Glimpse when available and falling back to Plannotator's browser UI. " +
      "Pass the path to a markdown plan file (e.g. .ged/work/main/TASKS.md). " +
      "The user can approve, deny with feedback, or request changes. " +
      "Returns the review decision. If no visual review surface is available, returns an error.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to the markdown plan file, relative to the working directory.",
        },
      },
      required: ["filePath"],
    },

    async execute(
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const { filePath } = params as { filePath: string };
      const makeResult = (
        text: string,
        approved: boolean,
        feedback?: string,
      ) => ({
        content: [{ type: "text" as const, text }],
        details: { approved, feedback },
      });

      if (!filePath?.trim()) {
        return makeResult("Error: filePath is required.", false);
      }

      const fullPath = resolve(ctx.cwd, filePath);
      let planContent: string;
      try {
        planContent = await readFile(fullPath, "utf-8");
      } catch {
        return makeResult(
          `Error: could not read ${filePath}. Write the plan file first.`,
          false,
        );
      }

      if (!planContent.trim()) {
        return makeResult(
          `Error: ${filePath} is empty. Write the plan content first.`,
          false,
        );
      }

      const glimpseDecision = await requestGlimpsePlanReview(planContent);
      if (glimpseDecision) {
        return {
          content: [
            {
              type: "text",
              text: glimpseDecision.approved
                ? glimpseDecision.feedback
                  ? `Plan approved in Glimpse with notes:\n\n${glimpseDecision.feedback}`
                  : "Plan approved in Glimpse."
                : glimpseDecision.feedback
                  ? `Plan denied in Glimpse. Reviewer feedback:\n\n${glimpseDecision.feedback}`
                  : "Plan denied in Glimpse without specific feedback.",
            },
          ],
          details: {
            approved: glimpseDecision.approved,
            feedback: glimpseDecision.feedback,
            surface: "glimpse",
          },
        };
      }

      const result = await requestPlanReview(api, planContent);

      if (result.status === "unavailable") {
        return makeResult(
          `Plannotator is unavailable: ${result.error ?? "extension not loaded or no UI support"}. Fall back to chat approval.`,
          false,
        );
      }

      if (result.status === "error") {
        return makeResult(
          `Plannotator error: ${result.error}. Fall back to chat approval.`,
          false,
        );
      }

      const reviewId = result.result?.reviewId;
      if (!reviewId) {
        return makeResult(
          "Plannotator returned no review ID. Fall back to chat approval.",
          false,
        );
      }

      const decision = await waitForReviewDecision(api, reviewId);

      if (!decision) {
        return makeResult(
          "Plannotator review timed out. Fall back to chat approval.",
          false,
        );
      }

      if (decision.approved) {
        return {
          content: [
            {
              type: "text",
              text: decision.feedback
                ? `Plan approved with notes:\n\n${decision.feedback}`
                : "Plan approved.",
            },
          ],
          details: {
            approved: true,
            feedback: decision.feedback,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: decision.feedback
              ? `Plan denied. Reviewer feedback:\n\n${decision.feedback}`
              : "Plan denied without specific feedback.",
          },
        ],
        details: {
          approved: false,
          feedback: decision.feedback,
        },
      };
    },
  });
}

export async function requestGlimpsePlanReview(
  planContent: string,
): Promise<PlanReviewResult | null> {
  let glimpse: GlimpseModule;
  try {
    glimpse = (await import("glimpseui")) as GlimpseModule;
  } catch {
    return null;
  }

  try {
    const result = await glimpse.prompt(
      buildGlimpsePlanReviewHtml(planContent),
      {
        width: 960,
        height: 760,
        title: "Review GedPi plan",
        floating: true,
        openLinks: true,
      },
    );

    if (!result || typeof result.approved !== "boolean") {
      return null;
    }

    return {
      approved: result.approved,
      feedback: result.feedback?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function buildGlimpsePlanReviewHtml(planContent: string): string {
  const escapedPlan = escapeHtml(planContent);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    header { padding: 16px 20px; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    h1 { margin: 0; font-size: 18px; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 320px; height: calc(100vh - 57px); }
    pre { margin: 0; padding: 20px; overflow: auto; white-space: pre-wrap; line-height: 1.45; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    aside { border-left: 1px solid color-mix(in srgb, CanvasText 14%, transparent); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    textarea { flex: 1; min-height: 220px; resize: none; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 10px; font: inherit; background: Canvas; color: CanvasText; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 650; cursor: pointer; }
    .approve { background: #15803d; color: white; }
    .deny { background: #b91c1c; color: white; }
    .cancel { background: color-mix(in srgb, CanvasText 10%, transparent); color: CanvasText; }
    .actions { display: grid; gap: 8px; }
    .hint { color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 12px; line-height: 1.35; }
  </style>
</head>
<body>
  <header><h1>Review GedPi plan</h1></header>
  <main>
    <pre>${escapedPlan}</pre>
    <aside>
      <label for="feedback"><strong>Feedback / notes</strong></label>
      <textarea id="feedback" placeholder="Optional: explain requested changes or approval notes"></textarea>
      <div class="actions">
        <button class="approve" id="approve">Approve plan</button>
        <button class="deny" id="deny">Deny / request changes</button>
        <button class="cancel" id="cancel">Use browser fallback</button>
      </div>
      <p class="hint">Enter approves. Escape falls back to Plannotator's browser UI.</p>
    </aside>
  </main>
  <script>
    const feedback = document.getElementById('feedback');
    function send(approved) { window.glimpse.send({ approved, feedback: feedback.value }); }
    document.getElementById('approve').addEventListener('click', () => send(true));
    document.getElementById('deny').addEventListener('click', () => send(false));
    document.getElementById('cancel').addEventListener('click', () => window.glimpse.send(null));
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send(true);
      if (event.key === 'Escape') window.glimpse.send(null);
    });
    feedback.focus();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function requestPlanReview(
  api: ExtensionAPI,
  planContent: string,
): Promise<PlannotatorResponse<{ reviewId: string }>> {
  return new Promise((resolve) => {
    const requestId = `gedpi-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      resolve({
        status: "unavailable",
        error: "No response from Plannotator extension (timed out).",
      });
    }, 5_000);

    api.events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
      requestId,
      action: "plan-review",
      payload: { planContent, origin: "gedpi" },
      respond(
        response: PlannotatorResponse<{ status: string; reviewId: string }>,
      ) {
        clearTimeout(timeout);
        if (response.status === "handled" && response.result) {
          resolve({
            status: "handled",
            result: { reviewId: response.result.reviewId },
          });
        } else {
          resolve(response as PlannotatorResponse<{ reviewId: string }>);
        }
      },
    });
  });
}

function waitForReviewDecision(
  api: ExtensionAPI,
  reviewId: string,
  timeoutMs = 600_000,
): Promise<PlanReviewResult | null> {
  return new Promise((res) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      res(null);
    }, timeoutMs);

    const unsubscribe = api.events.on(
      PLANNOTATOR_REVIEW_RESULT_CHANNEL,
      (data: unknown) => {
        const event = data as { reviewId?: string } & PlanReviewResult;
        if (event.reviewId === reviewId) {
          clearTimeout(timeout);
          unsubscribe();
          res({
            approved: event.approved,
            feedback: event.feedback,
            savedPath: event.savedPath,
            agentSwitch: event.agentSwitch,
            permissionMode: event.permissionMode,
          });
        }
      },
    );
  });
}
