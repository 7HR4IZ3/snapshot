import type { CommandContext, CommandResult } from "./types.js";
import { projectPathFromContext, toJsonResponse } from "./utils.js";

export async function runBackends(context: CommandContext): Promise<CommandResult> {
  const projectPath = projectPathFromContext(context.cwd, context.flags, context.positionals[0]);
  const inspection = context.backendService.inspect(projectPath);

  if (context.useJson) {
    return toJsonResponse(true, "backends", inspection);
  }

  const lines: string[] = [];
  lines.push(`Host platform: ${inspection.host.platform}`);
  lines.push(`worktree: ${inspection.host.worktree.available ? "available" : "unavailable"} (${inspection.host.worktree.reason})`);
  lines.push(`apfs-cow: ${inspection.host.apfsCow.available ? "available" : "unavailable"} (${inspection.host.apfsCow.reason})`);
  lines.push(`overlay: ${inspection.host.overlay.available ? "available" : "unavailable"} (${inspection.host.overlay.reason})`);

  if (inspection.project) {
    lines.push(`Project: ${inspection.project.path}`);
    lines.push(`Git repo: ${inspection.project.isGitRepo ? "yes" : "no"}`);
    lines.push(`Snapshot initialized: ${inspection.project.isSnapshotInitialized ? "yes" : "no"}`);
    lines.push(`Suggested default backend: ${inspection.project.defaultBackend}`);
    lines.push(
      `Workspace counts: worktree=${inspection.project.workspaceCounts.worktree ?? 0}, apfs-cow=${inspection.project.workspaceCounts["apfs-cow"] ?? 0}, overlay=${inspection.project.workspaceCounts.overlay ?? 0}`,
    );
  }

  return { lines };
}
