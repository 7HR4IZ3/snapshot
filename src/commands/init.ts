import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { resolve } from "node:path";
import { isSpawnedWorkspacePath, projectPathFromContext, toJsonResponse } from "./utils.js";

export async function runInit(context: CommandContext): Promise<CommandResult> {
  const legacyExplicit = context.positionals[0];
  const projectPath = projectPathFromContext(context.cwd, context.flags, legacyExplicit);
  const hasExplicitProject = typeof context.flags.project === "string" || Boolean(legacyExplicit);
  const rawExplicitProject = typeof context.flags.project === "string"
    ? resolve(context.cwd, context.flags.project)
    : legacyExplicit
      ? resolve(context.cwd, legacyExplicit)
      : undefined;

  if (!hasExplicitProject && isSpawnedWorkspacePath(context.cwd)) {
    throw new SnapshotError(
      "ERR_USAGE",
      "cannot initialize from a spawned workspace directory; run init from the canonical project",
    );
  }

  if (rawExplicitProject && isSpawnedWorkspacePath(rawExplicitProject)) {
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
