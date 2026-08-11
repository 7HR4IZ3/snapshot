import type { CommandContext, CommandResult } from "./types.js";
import { projectPathFromContext, toJsonResponse } from "./utils.js";
import { SnapshotError } from "../core/errors.js";
import { GitService } from "../infra/git/git-service.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { runSnapshotTui, type SnapshotTuiData } from "../ui/dashboard/run.js";

export async function runTui(context: CommandContext): Promise<CommandResult> {
  if (context.useJson) {
    return toJsonResponse(false, "tui", {}, [
      {
        code: "ERR_TUI_INTERACTIVE_ONLY",
        message: "snapshot tui is interactive and cannot emit JSON; use snapshot status/list/doctor for machine-readable data",
      },
    ]);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SnapshotError("ERR_TUI_TTY_REQUIRED", "snapshot tui requires an interactive TTY");
  }

  const projectPath = projectPathFromContext(context.cwd, context.flags, context.positionals[0]);
  const store = new MetadataStore();
  const git = new GitService();

  const load = (): SnapshotTuiData => {
    const inspection = context.backendService.inspect(projectPath);
    const workspaces = inspection.project?.isSnapshotInitialized
      ? context.workspaceService.list(projectPath, context.cwd)
      : [];
    const mergeSessions = inspection.project?.isSnapshotInitialized
      ? store.listMergeSessions(projectPath)
      : [];

    return {
      projectPath,
      branch: inspection.project?.isGitRepo ? git.currentBranch(projectPath).trim() : "",
      inspection,
      workspaces,
      mergeSessions,
    };
  };

  await runSnapshotTui(load);
  return { lines: [] };
}
