import type { CommandContext, CommandResult } from "./types.js";
import { projectPathFromContext, toJsonResponse } from "./utils.js";

export async function runList(context: CommandContext): Promise<CommandResult> {
  const projectPath = projectPathFromContext(context.cwd, context.flags, context.positionals[0]);
  const result = context.workspaceService.list(projectPath, context.cwd);

  if (context.useJson) {
    return toJsonResponse(true, "list", { projectPath, workspaces: result });
  }

  if (result.length === 0) {
    return { lines: ["No snapshot workspaces found."] };
  }

  return {
    lines: result.map(
      (workspace) =>
        `${workspace.workspaceId}\t${workspace.backend}\t${workspace.status}\t${workspace.changedFiles} files\t${workspace.workspacePath}`,
    ),
  };
}
