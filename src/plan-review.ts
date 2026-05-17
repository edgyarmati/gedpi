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

export function registerPlanReviewTool(api: ExtensionAPI): void {
  api.registerTool({
    name: "gedpi_plan_review",
    label: "Review Plan",
    description:
      "Open the GedPi draft plan for visual review in the browser using Plannotator. " +
      "Pass the path to a markdown plan file (e.g. .ged/work/main/TASKS.md). " +
      "The user reviews in the browser and can approve, deny with annotations, or request changes. " +
      "Returns the review decision. If Plannotator is unavailable, returns an error.",
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
