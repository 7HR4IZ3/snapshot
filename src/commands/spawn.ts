import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { flagString, parseCsvFlag, resolveProjectPathFromContext, toJsonResponse } from "./utils.js";
import type { WorkspaceBackend } from "../core/domain/workspace.js";

export async function runSpawn(context: CommandContext): Promise<CommandResult> {
  const positionals = context.positionals;
  const projectPath =
    positionals.length >= 2
      ? resolveProjectPathFromContext(context.cwd, positionals[0])
      : resolveProjectPathFromContext(context.cwd);
  const workspacePath = positionals.length >= 2 ? positionals[1] : positionals[0];
  if (!workspacePath) {
    throw new SnapshotError("ERR_USAGE", "missing required argument: workspace-path");
  }
  const backendFlag = flagString(context.flags, "backend");
  const backend: WorkspaceBackend | "auto" | undefined =
    backendFlag === "worktree" || backendFlag === "apfs-cow" || backendFlag === "overlay" || backendFlag === "auto"
      ? backendFlag
      : undefined;
  if (backendFlag && !backend) {
    throw new SnapshotError("ERR_USAGE", `invalid backend: ${backendFlag}`);
  }

  const symlinkModeFlag = flagString(context.flags, "symlink-mode");
  const symlinkMode =
    symlinkModeFlag === "shared-live" || symlinkModeFlag === "safety-restricted" ? symlinkModeFlag : undefined;
  if (symlinkModeFlag && !symlinkMode) {
    throw new SnapshotError("ERR_USAGE", `invalid symlink-mode: ${symlinkModeFlag}`);
  }

  const result = context.workspaceService.spawn({
    projectPath,
    workspacePath,
    agentId: flagString(context.flags, "agent"),
    label: flagString(context.flags, "label"),
    fromRef: flagString(context.flags, "from"),
    backend,
    strictBackend: context.flags["strict-backend"] === true,
    include: context.flags.include ? parseCsvFlag(flagString(context.flags, "include")) : undefined,
    exclude: context.flags.exclude ? parseCsvFlag(flagString(context.flags, "exclude")) : undefined,
    symlink: context.flags.symlink ? parseCsvFlag(flagString(context.flags, "symlink")) : undefined,
    symlinkMode,
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
