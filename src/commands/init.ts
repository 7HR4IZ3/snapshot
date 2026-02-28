import type { CommandContext, CommandResult } from "./types";
import { assertPositional, toJsonResponse } from "./utils";

export async function runInit(context: CommandContext): Promise<CommandResult> {
  const projectPath = assertPositional(context.positionals, 0, "project-path");
  const force = context.flags.force === true;
  const result = context.workspaceService.init(projectPath, force);

  if (context.useJson) {
    return toJsonResponse(true, "init", result);
  }

  return {
    lines: [`Initialized snapshot metadata in ${result.projectPath}`, `Config: ${result.configPath}`],
  };
}
