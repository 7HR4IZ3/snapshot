import type { CommandContext, CommandResult } from "./types.js";
import { classifyDiffLine, formatPatchForDiffView } from "../core/domain/diff-view.js";
import { assertPositional, flagString, toJsonResponse } from "./utils.js";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
} as const;

function colorize(line: string): string {
  if (line.length === 0) {
    return line;
  }

  const kind = classifyDiffLine(line);
  switch (kind) {
    case "file":
      return `${ANSI.bold}${ANSI.cyan}${line}${ANSI.reset}`;
    case "hunk":
      return `${ANSI.magenta}${line}${ANSI.reset}`;
    case "added":
      return `${ANSI.green}${line}${ANSI.reset}`;
    case "removed":
      return `${ANSI.red}${line}${ANSI.reset}`;
    case "gap":
      return `${ANSI.dim}${ANSI.gray}${line}${ANSI.reset}`;
    case "metadata":
      if (line.startsWith("new file mode") || line.startsWith("deleted file mode") || line.startsWith("similarity index")) {
        return `${ANSI.yellow}${line}${ANSI.reset}`;
      }
      return `${ANSI.gray}${line}${ANSI.reset}`;
    default:
      return line;
  }
}

function formatPatchForReview(patch: string, useColor: boolean): string {
  const lines = formatPatchForDiffView(patch, 2, true);
  if (!useColor) {
    return lines.join("\n");
  }
  return lines.map((line) => colorize(line)).join("\n");
}

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

  if (mode === "patch") {
    const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
    return { lines: [formatPatchForReview(String(result.output), useColor)] };
  }

  return { lines: [String(result.output)] };
}
