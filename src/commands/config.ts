import type { CommandContext, CommandResult } from "./types.js";
import { SnapshotError } from "../core/errors.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

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

function parseList(value: string): string[] {
  if (value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function runConfig(context: CommandContext): Promise<CommandResult> {
  const sub = context.positionals[0] ?? "get";

  if (sub === "get") {
    const projectPath = resolveProjectPathFromContext(context.cwd, context.positionals[1]);
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
    const projectPath = resolveProjectPathFromContext(context.cwd, context.positionals[3]);
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
    } else if (key === "workspace.include") {
      config.workspace.include = parseList(value);
    } else if (key === "workspace.exclude") {
      config.workspace.exclude = parseList(value);
    } else if (key === "workspace.symlink") {
      config.workspace.symlink = parseList(value);
    } else if (key === "workspace.symlinkMode") {
      if (!["shared-live", "safety-restricted"].includes(value)) {
        throw new SnapshotError("ERR_USAGE", `invalid symlinkMode: ${value}`);
      }
      config.workspace.symlinkMode = value as "shared-live" | "safety-restricted";
    } else if (key === "merge.prefer") {
      if (!["none", "virtual", "target"].includes(value)) {
        throw new SnapshotError("ERR_USAGE", `invalid merge.prefer: ${value}`);
      }
      config.merge.prefer = value as "none" | "virtual" | "target";
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
