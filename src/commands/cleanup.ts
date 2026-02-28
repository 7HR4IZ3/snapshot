import type { CommandContext, CommandResult } from "./types.js";
import { assertPositional, resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

export async function runCleanup(context: CommandContext): Promise<CommandResult> {
  const allArchived = context.flags["all-archived"] === true;
  const workspaceRef = allArchived ? undefined : assertPositional(context.positionals, 0, "workspace-ref");
  const projectPath = allArchived ? resolveProjectPathFromContext(context.cwd, context.positionals[0]) : undefined;

  const result = context.workspaceService.cleanup({
    workspaceRef,
    cwd: context.cwd,
    projectPath,
    deleteBranch: context.flags["delete-branch"] === true,
    force: context.flags.force === true,
    allArchived,
  });

  if (context.useJson) {
    return toJsonResponse(true, "cleanup", result);
  }

  if (result.mode === "all-archived") {
    return { lines: [`Removed archived records: ${result.removedRecords ?? 0}`] };
  }

  return {
    lines: [
      `Archived workspace ${result.workspaceId}`,
      `Removed worktree: ${result.workspacePath}`,
      `Branch: ${result.branch}${result.branchDeleted ? " (deleted)" : " (kept)"}`,
    ],
  };
}
