import type { CommandContext, CommandResult } from "./types";
import { assertPositional, flagString, toJsonResponse } from "./utils";

export async function runDiff(context: CommandContext): Promise<CommandResult> {
  const workspaceRef = assertPositional(context.positionals, 0, "workspace-ref");
  const mode = context.flags["name-only"] ? "name-only" : context.flags.stat ? "stat" : "patch";
  const base = flagString(context.flags, "base");
  const result = context.workspaceService.diff(workspaceRef, context.cwd, mode, base);

  if (context.useJson) {
    return toJsonResponse(true, "diff", {
      workspaceId: result.record.workspaceId,
      baseCommit: base ?? result.record.baseCommit,
      mode,
      output: result.output,
    });
  }

  if (mode === "name-only") {
    const changes = result.output as Array<{ status: string; path: string }>;
    return { lines: changes.map((change) => `${change.status}\t${change.path}`) };
  }

  return { lines: [String(result.output)] };
}
