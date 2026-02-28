import type { CommandContext, CommandResult } from "./types.js";
import { resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

export async function runRepairMounts(context: CommandContext): Promise<CommandResult> {
  const projectPath = resolveProjectPathFromContext(context.cwd, context.positionals[0]);
  const result = context.workspaceService.repairMounts({ projectPath });

  if (context.useJson) {
    return toJsonResponse(true, "repair-mounts", result);
  }

  return {
    lines: [
      `Project: ${result.projectPath}`,
      `Overlay states checked: ${result.checked}`,
      `Overlay states repaired: ${result.repaired}`,
      ...result.notes.map((note) => `- ${note}`),
    ],
  };
}
