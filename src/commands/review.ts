import type { CommandContext, CommandResult } from "./types.js";
import { flagString, resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

export async function runReview(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = context.positionals[0];
  const cwd = context.cwd;

  if (!workspaceRef || workspaceRef === "." || workspaceRef === "/") {
    const projectPath = resolveProjectPathFromContext(cwd);
    const result = await context.reviewService.reviewAll({
      projectPath,
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
        lines: ["Review not saved.", `Workspaces inspected: ${result.preview ? (result.preview as Array<unknown>).length : 0}`],
      };
    }

    return {
      lines: [
        `Saved ${result.records.length} review(s)`,
        result.records
          .map((r) => `  - ${r.workspaceId}: ${r.overallDecision}`)
          .join("\n"),
      ],
    };
  }

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
