import type { CommandContext, CommandResult } from "./types.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { assertPositional, flagString, projectPathFromContext, toJsonResponse } from "./utils.js";

const store = new MetadataStore();

export async function runMerge(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = assertPositional(context.positionals, 0, "workspace-ref");
  const legacyProjectPath = context.positionals[1];
  const projectPath = context.flags.project
    ? projectPathFromContext(context.cwd, context.flags, legacyProjectPath)
    : legacyProjectPath ?? store.resolveWorkspaceRef(workspaceRef, context.cwd).projectPath;
  const preferFlag = flagString(context.flags, "prefer");
  const prefer =
    preferFlag === "virtual" || preferFlag === "target" || preferFlag === "none" ? preferFlag : undefined;
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
