import type { CommandContext, CommandResult } from "./types";
import { assertPositional, toJsonResponse } from "./utils";

export async function runStatus(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = assertPositional(context.positionals, 0, "workspace-ref");
  const result = context.workspaceService.status(workspaceRef, context.cwd);
  const payload = {
    workspaceId: result.record.workspaceId,
    agentId: result.record.agentId,
    label: result.record.label,
    branch: result.record.workspaceBranch,
    backend: result.record.backend,
    baseCommit: result.record.baseCommit,
    headCommit: result.headSha,
    status: result.record.status,
    reviewStatus: result.reviewStatus,
    changedFiles: result.changes.length,
    changes: result.changes,
  };

  if (context.useJson) {
    return toJsonResponse(true, "status", payload);
  }

  return {
    lines: [
      `Workspace: ${payload.workspaceId}`,
      `Branch: ${payload.branch}`,
      `Backend: ${payload.backend}`,
      `Base: ${payload.baseCommit}`,
      `Head: ${payload.headCommit}`,
      `Review: ${payload.reviewStatus}`,
      `Changed files: ${payload.changedFiles}`,
      ...result.changes.map((change) => `  ${change.status}\t${change.path}`),
    ],
  };
}
