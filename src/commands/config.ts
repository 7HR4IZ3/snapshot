import type { CommandContext, CommandResult } from "./types";
import { SnapshotError } from "../core/errors";
import { MetadataStore } from "../infra/metadata/metadata-store";
import { toJsonResponse } from "./utils";

const store = new MetadataStore();

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new SnapshotError("ERR_USAGE", `expected boolean value, got: ${value}`);
}

export async function runConfig(context: CommandContext): Promise<CommandResult> {
  const sub = context.positionals[0] ?? "get";

  if (sub === "get") {
    const projectPath = context.positionals[1] ?? context.cwd;
    const config = store.loadConfig(projectPath);
    if (context.useJson) {
      return toJsonResponse(true, "config", { projectPath, config });
    }
    return {
      lines: [JSON.stringify(config, null, 2)],
    };
  }

  if (sub === "set") {
    const key = context.positionals[1];
    const value = context.positionals[2];
    const projectPath = context.positionals[3] ?? context.cwd;
    if (!key || value === undefined) {
      throw new SnapshotError("ERR_USAGE", "config set requires: <key> <value> [project-path]");
    }

    const config = store.loadConfig(projectPath);
    if (key === "workspace.backendDefault") {
      if (!["auto", "worktree", "apfs-cow", "overlay"].includes(value)) {
        throw new SnapshotError("ERR_USAGE", `invalid backendDefault: ${value}`);
      }
      config.workspace.backendDefault = value as "auto" | "worktree" | "apfs-cow" | "overlay";
    } else if (key === "workspace.fallbackPolicy") {
      if (!["best-available", "error"].includes(value)) {
        throw new SnapshotError("ERR_USAGE", `invalid fallbackPolicy: ${value}`);
      }
      config.workspace.fallbackPolicy = value as "best-available" | "error";
    } else if (key === "merge.autoCommit") {
      config.merge.autoCommit = parseBoolean(value);
    } else if (key === "merge.stopOnConflict") {
      config.merge.stopOnConflict = parseBoolean(value);
    } else if (key === "review.requireApprovalBeforeMerge") {
      config.review.requireApprovalBeforeMerge = parseBoolean(value);
    } else {
      throw new SnapshotError("ERR_USAGE", `unsupported config key: ${key}`);
    }

    store.writeConfig(projectPath, config);

    if (context.useJson) {
      return toJsonResponse(true, "config", { projectPath, key, value, config });
    }
    return {
      lines: [`Updated ${key}=${value}`, `Config: ${store.configPath(projectPath)}`],
    };
  }

  throw new SnapshotError("ERR_USAGE", `unknown config subcommand: ${sub}`);
}
