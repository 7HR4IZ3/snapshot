import type { CommandContext, CommandResult } from "./types.js";
import { projectPathFromContext, toJsonResponse } from "./utils.js";

export async function runPullAll(context: CommandContext): Promise<CommandResult> {
  const projectPath = projectPathFromContext(context.cwd, context.flags, context.positionals[0]);
  const result = context.fileSnapshotService.pullAll({
    projectPath,
    cwd: context.cwd,
    force: context.flags.force === true,
  });

  if (context.useJson) {
    return toJsonResponse(true, "pull-all", result);
  }

  return {
    lines: [
      `Project: ${result.projectPath}`,
      `Entries: ${result.entries.length}`,
      ...result.entries.map((entry) => `${entry.fileSnapshotId}\t${entry.result}\t${entry.repoRelativePath}`),
    ],
  };
}
