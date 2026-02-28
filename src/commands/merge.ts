import type { CommandContext, CommandResult } from "./types";
import { assertPositional, flagString, toJsonResponse } from "./utils";

export async function runMerge(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = assertPositional(context.positionals, 0, "workspace-ref");
  const projectPath = assertPositional(context.positionals, 1, "project-path");
  const preferFlag = flagString(context.flags, "prefer");
  const prefer = preferFlag === "virtual" || preferFlag === "target" ? preferFlag : undefined;
  const commit =
    context.flags.commit === true ? true : context.flags["no-commit"] === true ? false : undefined;

  const session = context.mergeService.merge({
    workspaceRef,
    projectPath,
    cwd: context.cwd,
    targetBranch: flagString(context.flags, "target"),
    prefer,
    commit,
    message: flagString(context.flags, "message"),
  });

  if (context.useJson) {
    return toJsonResponse(true, "merge", session);
  }

  const entry = session.entries[0];
  return {
    lines: [
      `Merge session: ${session.mergeSessionId}`,
      `Workspace: ${entry?.workspaceId ?? "unknown"}`,
      `Result: ${entry?.result ?? "unknown"}`,
      `Target branch: ${session.targetBranch}`,
      `Target sha: ${session.targetEndSha}`,
    ],
  };
}
