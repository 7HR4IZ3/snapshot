import type { CommandContext, CommandResult } from "./types";
import { toJsonResponse } from "./utils";

export async function runRepairMounts(context: CommandContext): Promise<CommandResult> {
  const projectPath = context.positionals[0] ?? context.cwd;
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
