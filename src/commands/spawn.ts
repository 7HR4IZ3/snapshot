import type { CommandContext, CommandResult } from "./types";
import { SnapshotError } from "../core/errors";
import { assertPositional, flagString, toJsonResponse } from "./utils";
import type { WorkspaceBackend } from "../core/domain/workspace";

export async function runSpawn(context: CommandContext): Promise<CommandResult> {
  const projectPath = assertPositional(context.positionals, 0, "project-path");
  const workspacePath = assertPositional(context.positionals, 1, "workspace-path");
  const backendFlag = flagString(context.flags, "backend");
  const backend: WorkspaceBackend | "auto" | undefined =
    backendFlag === "worktree" || backendFlag === "apfs-cow" || backendFlag === "overlay" || backendFlag === "auto"
      ? backendFlag
      : undefined;
  if (backendFlag && !backend) {
    throw new SnapshotError("ERR_USAGE", `invalid backend: ${backendFlag}`);
  }
  const result = context.workspaceService.spawn({
    projectPath,
    workspacePath,
    agentId: flagString(context.flags, "agent"),
    label: flagString(context.flags, "label"),
    fromRef: flagString(context.flags, "from"),
    backend,
    strictBackend: context.flags["strict-backend"] === true,
  });

  if (context.useJson) {
    return toJsonResponse(true, "spawn", result);
  }

  return {
    lines: [
      `Spawned workspace ${result.workspaceId}`,
      `Path: ${result.workspacePath}`,
      `Branch: ${result.workspaceBranch}`,
      `Backend: ${result.backend}`,
      `Base: ${result.baseCommit}`,
    ],
  };
}
