import type { CommandContext, CommandResult } from "./types";
import { assertPositional, flagString, toJsonResponse } from "./utils";

export async function runReview(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = assertPositional(context.positionals, 0, "workspace-ref");
  const result = await context.reviewService.review({
    workspaceRef,
    cwd: context.cwd,
    reviewerId: flagString(context.flags, "reviewer"),
    exportPath: flagString(context.flags, "export"),
    readonly: context.flags.readonly === true,
    approveAll: context.flags["approve-all"] === true,
  });

  if (context.useJson) {
    return toJsonResponse(true, "review", result);
  }

  if (!result.saved) {
    return {
      lines: ["Review not saved.", `Files inspected: ${(result.preview as Array<unknown>).length}`],
    };
  }

  return {
    lines: [
      `Saved review ${(result.record && result.record.reviewId) || "unknown"}`,
      `Decision: ${(result.record && result.record.overallDecision) || "in_review"}`,
    ],
  };
}
