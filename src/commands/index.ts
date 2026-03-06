import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonError, JsonResponse } from "../core/domain/common.js";
import { SnapshotError } from "../core/errors.js";
import { ConflictService } from "../core/services/conflict-service.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import type { CommandContext, CommandResult } from "./types.js";
import { toJsonResponse, flagString } from "./utils.js";
import { runInit } from "./init.js";
import { runSpawn } from "./spawn.js";
import { runSpawnFile } from "./spawn-file.js";
import { runList } from "./list.js";
import { runStatus } from "./status.js";
import { runDiff } from "./diff.js";
import { runReview } from "./review.js";
import { runMerge } from "./merge.js";
import { runMergeMany } from "./merge-many.js";
import { runPullFile } from "./pull-file.js";
import { runPullAll } from "./pull-all.js";
import { runCleanup } from "./cleanup.js";
import { runUnlock } from "./unlock.js";
import { runRevert } from "./revert.js";
import { runBackends } from "./backends.js";
import { runConfig } from "./config.js";
import { runRepairMounts } from "./repair-mounts.js";
import { runDoctor } from "./doctor.js";

export type CommandName =
  | "init"
  | "spawn"
  | "spawn-file"
  | "list"
  | "status"
  | "diff"
  | "review"
  | "merge"
  | "merge-many"
  | "pull-file"
  | "pull-all"
  | "cleanup"
  | "unlock"
  | "revert"
  | "backends"
  | "config"
  | "repair-mounts"
  | "doctor";

function printResult(result: CommandResult): void {
  if ("ok" in result) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of result.lines) {
    console.log(line);
  }
}

export async function executeCommand(command: CommandName, context: CommandContext): Promise<void> {
  const conflictService = new ConflictService();
  try {
    let result: CommandResult;
    switch (command) {
      case "init":
        result = await runInit(context);
        break;
      case "spawn":
        result = await runSpawn(context);
        break;
      case "spawn-file":
        result = await runSpawnFile(context);
        break;
      case "list":
        result = await runList(context);
        break;
      case "status":
        result = await runStatus(context);
        break;
      case "diff":
        result = await runDiff(context);
        break;
      case "review":
        result = await runReview(context);
        break;
      case "merge":
        result = await runMerge(context);
        break;
      case "merge-many":
        result = await runMergeMany(context);
        break;
      case "pull-file":
        result = await runPullFile(context);
        break;
      case "pull-all":
        result = await runPullAll(context);
        break;
      case "cleanup":
        result = await runCleanup(context);
        break;
      case "unlock":
        result = await runUnlock(context);
        break;
      case "revert":
        result = await runRevert(context);
        break;
      case "backends":
        result = await runBackends(context);
        break;
      case "config":
        result = await runConfig(context);
        break;
      case "repair-mounts":
        result = await runRepairMounts(context);
        break;
      case "doctor":
        result = await runDoctor(context);
        break;
      default:
        throw new SnapshotError("ERR_USAGE", `unknown command: ${String(command)}`);
    }

    printResult(result);
  } catch (error) {
    const snapshotError =
      error instanceof SnapshotError
        ? error
        : new SnapshotError("ERR_INTERNAL", "unexpected error", {
            message: error instanceof Error ? error.message : String(error),
          });

    const errors: JsonError[] = [
      {
        code: snapshotError.code,
        message: snapshotError.message,
        details: snapshotError.details,
      },
    ];

    if (context.useJson) {
      const payload: JsonResponse = toJsonResponse(false, command, {}, errors);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.error(`${snapshotError.code}: ${snapshotError.message}`);
      if (snapshotError.details && context.flags.verbose === true) {
        console.error(JSON.stringify(snapshotError.details, null, 2));
      }
    }

    if (command === "merge-many") {
      const reportPath = flagString(context.flags, "report");
      if (reportPath && snapshotError.details) {
        const fullPath = resolve(context.cwd, reportPath);
        writeFileSync(fullPath, `${JSON.stringify(snapshotError.details, null, 2)}\n`, "utf8");
        if (!context.useJson) {
          console.error(`Report: ${fullPath}`);
        }
      }
    }

    if (snapshotError.code === "ERR_MERGE_CONFLICT" && !context.useJson && snapshotError.details) {
      const maybeProjectPath = snapshotError.details.projectPath;
      if (typeof maybeProjectPath === "string") {
        const entries = snapshotError.details.entries as Array<{ workspaceId: string; workspaceBranch: string; result: string; unresolvedConflicts: Array<{ path: string }> }> | undefined;
        const isMergeMany = entries && entries.length > 1;
        
        if (isMergeMany && entries) {
          const conflictedEntries = entries.filter(e => e.result === "conflict");
          if (conflictedEntries.length > 0) {
            const store = new MetadataStore();
            const workspaces = conflictedEntries.map((entry) => {
              const record = store.loadWorkspaceRecord(maybeProjectPath, entry.workspaceId);
              return {
                workspaceId: entry.workspaceId,
                workspacePath: record?.workspacePath || "",
                label: record?.label || entry.workspaceId,
              };
            });
            
            const handled = await conflictService.handleMultiWorkspaceConflicts(maybeProjectPath, workspaces);
            if (handled.resolved) {
              console.log("Conflicts resolved and staged. Complete the merge with git commit.");
              return;
            }
            console.error(`Unresolved conflicts remaining: ${handled.unresolvedPaths.length}`);
          }
        } else {
          const handled = await conflictService.handleConflictFromError(maybeProjectPath, snapshotError.details);
          if (handled.unresolved.length === 0) {
            console.log("Conflicts resolved and staged. Complete the merge with git commit.");
            return;
          }
          console.error(`Unresolved conflicts remaining: ${handled.unresolved.length}`);
        }
      }
    }

    if (
      snapshotError.code === "ERR_MERGE_CONFLICT" ||
      snapshotError.code === "ERR_REVERT_CONFLICT" ||
      snapshotError.code === "ERR_FILE_SNAPSHOT_CONFLICT"
    ) {
      process.exit(3);
      return;
    }
    if (snapshotError.code === "ERR_USAGE") {
      process.exit(2);
      return;
    }
    if (snapshotError.code === "ERR_TARGET_DIRTY" || snapshotError.code === "ERR_LOCK_HELD") {
      process.exit(4);
      return;
    }
    process.exit(1);
  }
}
