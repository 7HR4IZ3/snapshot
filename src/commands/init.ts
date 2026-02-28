import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { resolve } from "node:path";
import { isSpawnedWorkspacePath, toJsonResponse } from "./utils.js";

export async function runInit(context: CommandContext): Promise<CommandResult> {
  const explicit = context.positionals[0];
  const projectPath = explicit ? resolve(explicit) : resolve(context.cwd);

  if (!explicit && isSpawnedWorkspacePath(context.cwd)) {
    throw new SnapshotError(
      "ERR_USAGE",
      "cannot initialize from a spawned workspace directory; run init from the canonical project",
    );
  }

  if (explicit && isSpawnedWorkspacePath(resolve(explicit))) {
    throw new SnapshotError(
      "ERR_USAGE",
      "cannot initialize a spawned workspace directory; use the canonical project path",
    );
  }

  const force = context.flags.force === true;
  const result = context.workspaceService.init(projectPath, force);

  if (context.useJson) {
    return toJsonResponse(true, "init", result);
  }

  return {
    lines: [
      `${result.created ? "Initialized" : "Already initialized"} snapshot metadata in ${result.projectPath}`,
      `Config: ${result.configPath}`,
    ],
  };
}
