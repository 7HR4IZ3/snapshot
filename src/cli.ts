#!/usr/bin/env bun
import { executeCommand, type CommandName } from "./commands/index.js";
import { BackendService } from "./core/services/backend-service.js";
import { FileSnapshotService } from "./core/services/file-snapshot-service.js";
import { MergeService } from "./core/services/merge-service.js";
import { RevertService } from "./core/services/revert-service.js";
import { ReviewService } from "./core/services/review-service.js";
import { WorkspaceService } from "./core/services/workspace-service.js";

interface ParsedArgs {
  command?: CommandName;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const tokensAfterRuntime = argv.slice(2);
  let commandIndex = 0;
  while (["--json", "--verbose", "--help"].includes(tokensAfterRuntime[commandIndex] ?? "")) {
    commandIndex += 1;
  }
  const maybeCommand = tokensAfterRuntime[commandIndex];
  const command = maybeCommand && !maybeCommand.startsWith("--")
    ? (maybeCommand as CommandName)
    : undefined;
  const tokens = command ? tokensAfterRuntime.slice(commandIndex + 1) : tokensAfterRuntime;
  const flags: Record<string, string | boolean> = {};
  for (const globalFlag of tokensAfterRuntime.slice(0, commandIndex)) {
    flags[globalFlag.slice(2)] = true;
  }
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split("=", 2);
      if (!name) {
        continue;
      }
      if (inline !== undefined) {
        flags[name] = inline;
      } else {
        const next = tokens[i + 1];
        if (next && !next.startsWith("--")) {
          flags[name] = next;
          i += 1;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

function usage(): string {
  return [
    "snapshot - git-only multi-agent workspace tool",
    "",
    "Commands:",
    "  snapshot init [project-path] [--force]",
    "  snapshot spawn [project-path] <workspace-path> [--agent <id>] [--label <name>] [--from <ref>] [--backend auto|worktree|apfs-cow|overlay] [--strict-backend] [--include <csv-globs>] [--exclude <csv-globs>] [--symlink <csv-globs>] [--symlink-mode shared-live|safety-restricted]",
    "  snapshot spawn-file [project-path] <source-file> <snapshot-file> [--agent <id>] [--label <name>]",
    "  snapshot list [project-path]",
    "  snapshot status <workspace-path|workspace-id>",
    "  snapshot diff <workspace-path|workspace-id> [--name-only|--patch|--stat] [--base <sha>]",
    "  snapshot review <workspace-ref> [--reviewer <id>] [--export <path>] [--readonly] [--approve-all]",
    "  snapshot merge <workspace-ref> [project-path] [--target <branch>] [--prefer <none|virtual|target>] [--commit|--no-commit] [--message <text>]",
    "  snapshot merge-many [project-path] --from <refs> [--order <created|priority|manual>] [--continue-on-conflict] [--preflight] [--prefer <none|virtual|target>] [--commit|--no-commit] [--report <path>]",
    "  snapshot pull-file <snapshot-ref> [project-path] [--force]",
    "  snapshot pull-all [project-path] [--force]",
    "  snapshot cleanup <workspace-ref> [--delete-branch] [--force]",
    "  snapshot cleanup [project-path] --all-archived",
    "  snapshot unlock [project-path] --force",
    "  snapshot revert [project-path] (--session <merge-session-id> | --last) [--abort]",
    "  snapshot backends [project-path]",
    "  snapshot config get [project-path]",
    "  snapshot config set <key> <value> [project-path]",
    "  snapshot repair-mounts [project-path]",
    "  snapshot doctor [project-path] [--repair]",
    "",
    "Global flags:",
    "  --json      machine-readable output",
    "  --verbose   include extra diagnostics",
  ].join("\n");
}

async function run(): Promise<void> {
  const parsed = parseArgv(Bun.argv);
  const useJson = parsed.flags.json === true;

  if (!parsed.command || parsed.flags.help === true) {
    if (useJson) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "help",
            timestamp: new Date().toISOString(),
            data: { usage: usage() },
            errors: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.log(usage());
    }
    return;
  }

  await executeCommand(parsed.command, {
    cwd: process.cwd(),
    useJson,
    flags: parsed.flags,
    positionals: parsed.positionals,
    backendService: new BackendService(),
    fileSnapshotService: new FileSnapshotService(),
    workspaceService: new WorkspaceService(),
    mergeService: new MergeService(),
    revertService: new RevertService(),
    reviewService: new ReviewService(),
  });
}

run();
