import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandContext, CommandResult } from "./types";
import { SnapshotError } from "../core/errors";
import { flagString, parseCsvFlag, toJsonResponse } from "./utils";

export async function runMergeMany(context: CommandContext): Promise<CommandResult> {
  const projectPath = context.positionals[0];
  if (!projectPath) {
    throw new SnapshotError("ERR_USAGE", "missing required argument: project-path");
  }

  const refs = parseCsvFlag(flagString(context.flags, "from"));
  if (refs.length === 0) {
    throw new SnapshotError("ERR_USAGE", "merge-many requires --from <ref1,ref2,...>");
  }

  const orderFlag = flagString(context.flags, "order");
  const order = orderFlag === "created" || orderFlag === "priority" || orderFlag === "manual" ? orderFlag : undefined;

  if (context.flags.preflight === true) {
    const preflight = context.mergeService.preflightMany({
      projectPath,
      workspaceRefs: refs,
      cwd: context.cwd,
      order,
    });

    if (context.useJson) {
      return toJsonResponse(true, "merge-many", { mode: "preflight", ...preflight });
    }
    return {
      lines: [
        `Preflight order: ${preflight.order}`,
        ...preflight.entries.map(
          (entry) =>
            `${entry.workspaceRef}\t${entry.eligible ? "eligible" : "ineligible"}\t${entry.reason ?? "ok"}`,
        ),
      ],
    };
  }

  const preferFlag = flagString(context.flags, "prefer");
  const prefer = preferFlag === "virtual" || preferFlag === "target" ? preferFlag : undefined;

  const session = context.mergeService.mergeMany({
    projectPath,
    workspaceRefs: refs,
    cwd: context.cwd,
    targetBranch: flagString(context.flags, "target"),
    prefer,
    commit:
      context.flags.commit === true
        ? true
        : context.flags["no-commit"] === true
          ? false
          : undefined,
    message: flagString(context.flags, "message"),
    order,
    continueOnConflict:
      context.flags["continue-on-conflict"] === true
        ? true
        : context.flags["stop-on-conflict"] === true
          ? false
          : undefined,
  });

  const reportPath = flagString(context.flags, "report");
  const fullReportPath = reportPath ? resolve(context.cwd, reportPath) : null;
  if (fullReportPath) {
    writeFileSync(fullReportPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  }

  if (context.useJson) {
    return toJsonResponse(true, "merge-many", session);
  }

  return {
    lines: [
      `Merge session: ${session.mergeSessionId}`,
      `Mode: ${session.mode}`,
      `Entries: ${session.entries.length}`,
      ...session.entries.map((entry) => `${entry.workspaceId}\t${entry.result}\t${entry.artifactPath ?? "-"}`),
      ...(fullReportPath ? [`Report: ${fullReportPath}`] : []),
    ],
    reportPath: fullReportPath,
  };
}
