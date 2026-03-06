import type { CommandContext, CommandResult } from "./types.js";
import { assertPositional, resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

export async function runPullFile(context: CommandContext): Promise<CommandResult> {
  const snapshotRef = assertPositional(context.positionals, 0, "snapshot-ref");
  const projectPath = context.positionals[1]
    ? resolveProjectPathFromContext(context.cwd, context.positionals[1])
    : undefined;

  const result = context.fileSnapshotService.pull({
    snapshotRef,
    projectPath,
    cwd: context.cwd,
    force: context.flags.force === true,
  });

  if (context.useJson) {
    return toJsonResponse(true, "pull-file", result);
  }

  return {
    lines: [
      `File snapshot: ${result.fileSnapshotId}`,
      `Path: ${result.repoRelativePath}`,
      `Result: ${result.result}`,
      `Message: ${result.message}`,
    ],
  };
}
