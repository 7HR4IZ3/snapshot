import type { CommandContext, CommandResult } from "./types.js";
import { flagString, projectPathFromContext, toJsonResponse } from "./utils.js";

export async function runRevert(context: CommandContext): Promise<CommandResult> {
  const projectPath = projectPathFromContext(context.cwd, context.flags, context.positionals[0]);
  const mergeSessionId = flagString(context.flags, "session");
  const last = context.flags.last === true;
  const abort = context.flags.abort === true;

  const result = context.revertService.revert({
    projectPath,
    mergeSessionId,
    last,
    abort,
  });

  if (context.useJson) {
    return toJsonResponse(true, "revert", result);
  }

  if (abort) {
    return {
      lines: ["Revert sequence aborted.", `Head: ${result.targetHead}`],
    };
  }

  return {
    lines: [
      `Reverted merge session: ${result.mergeSessionId}`,
      `Reverted commits: ${result.revertedCommits.length}`,
      ...result.revertedCommits.map((sha) => `  ${sha}`),
      `Head: ${result.targetHead}`,
    ],
  };
}
