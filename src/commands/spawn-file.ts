import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { flagString, resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

export async function runSpawnFile(context: CommandContext): Promise<CommandResult> {
  const positionals = context.positionals;
  const projectPath =
    positionals.length >= 3
      ? resolveProjectPathFromContext(context.cwd, positionals[0])
      : resolveProjectPathFromContext(context.cwd);
  const sourcePath = positionals.length >= 3 ? positionals[1] : positionals[0];
  const snapshotPath = positionals.length >= 3 ? positionals[2] : positionals[1];

  if (!sourcePath) {
    throw new SnapshotError("ERR_USAGE", "missing required argument: source-file");
  }
  if (!snapshotPath) {
    throw new SnapshotError("ERR_USAGE", "missing required argument: snapshot-file");
  }

  const result = context.fileSnapshotService.spawn({
    projectPath,
    sourcePath,
    snapshotPath,
    agentId: flagString(context.flags, "agent"),
    label: flagString(context.flags, "label"),
  });

  if (context.useJson) {
    return toJsonResponse(true, "spawn-file", result);
  }

  return {
    lines: [
      `Spawned file snapshot ${result.fileSnapshotId}`,
      `Source: ${result.sourcePath}`,
      `Snapshot: ${result.snapshotPath}`,
    ],
  };
}
