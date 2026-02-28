import { resolve } from "node:path";
import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { LockService } from "../infra/lock/lock-service.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { toJsonResponse } from "./utils.js";

const locks = new LockService();
const store = new MetadataStore();

export async function runUnlock(context: CommandContext): Promise<CommandResult> {
  if (context.flags.force !== true) {
    throw new SnapshotError("ERR_USAGE", "unlock requires --force");
  }

  const projectPath = resolve(context.positionals[0] ?? context.cwd);
  const lockPath = store.mergeLockPath(projectPath);
  const result = locks.forceUnlock(lockPath);

  if (context.useJson) {
    return toJsonResponse(true, "unlock", {
      projectPath,
      lockPath,
      ...result,
    });
  }

  if (!result.unlocked) {
    return { lines: ["No lock file to remove."] };
  }

  return { lines: [`Unlocked ${lockPath}`] };
}
