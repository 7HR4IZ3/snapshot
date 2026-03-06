import { SnapshotError } from "../errors.js";
import { GitService } from "../../infra/git/git-service.js";
import { runConflictTui } from "../../ui/conflicts/run.js";
import {
  runMultiConflictTui,
  type MultiConflictItem,
} from "../../ui/multi-conflict/run.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface ConflictDetails {
  path?: string;
  class?: string;
  guidance?: string;
}

export class ConflictService {
  constructor(private readonly git = new GitService()) {}

  async handleConflictFromError(
    projectPath: string,
    details: Record<string, unknown>,
  ): Promise<{ unresolved: string[] }> {
    const unresolved = this.git.unresolvedConflicts(projectPath);
    if (unresolved.length === 0) {
      return { unresolved };
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return { unresolved };
    }

    const detailsMap = this.buildDetailsMap(details);
    const items = unresolved.map((path) => {
      const d = detailsMap.get(path);
      return {
        path,
        className: d?.class ?? "unknown_conflict",
        guidance: d?.guidance ?? "Resolve manually if needed",
        targetText: this.readConflictStageText(projectPath, path, 2),
        workspaceText: this.readConflictStageText(projectPath, path, 3),
        conflictedText: this.readWorkingTreeText(projectPath, path),
      };
    });

    const result = await runConflictTui(items);
    if (result.finalized) {
      for (const decision of result.decisions) {
        if (decision.action === "keep-target") {
          this.checkoutSide(projectPath, "--ours", decision.path);
          this.stage(projectPath, decision.path);
        } else if (decision.action === "keep-workspace") {
          this.checkoutSide(projectPath, "--theirs", decision.path);
          this.stage(projectPath, decision.path);
        } else if (decision.action === "manual-merge") {
          if (typeof decision.mergedText !== "string") {
            continue;
          }
          this.writeMergedText(projectPath, decision.path, decision.mergedText);
          this.stage(projectPath, decision.path);
        }
      }
    }

    return { unresolved: this.git.unresolvedConflicts(projectPath) };
  }

  private buildDetailsMap(
    details: Record<string, unknown>,
  ): Map<string, ConflictDetails> {
    const map = new Map<string, ConflictDetails>();

    const conflicts = details.conflicts;
    if (Array.isArray(conflicts)) {
      for (const item of conflicts) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const row = item as Record<string, unknown>;
        const path = typeof row.path === "string" ? row.path : null;
        if (!path) {
          continue;
        }
        map.set(path, {
          path,
          class: typeof row.class === "string" ? row.class : undefined,
          guidance: typeof row.guidance === "string" ? row.guidance : undefined,
        });
      }
    }

    const entries = details.entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const unresolved = (entry as Record<string, unknown>)
          .unresolvedConflicts;
        if (!Array.isArray(unresolved)) {
          continue;
        }
        for (const item of unresolved) {
          if (!item || typeof item !== "object") {
            continue;
          }
          const row = item as Record<string, unknown>;
          const path = typeof row.path === "string" ? row.path : null;
          if (!path) {
            continue;
          }
          map.set(path, {
            path,
            class: typeof row.class === "string" ? row.class : undefined,
            guidance:
              typeof row.guidance === "string" ? row.guidance : undefined,
          });
        }
      }
    }

    return map;
  }

  private checkoutSide(
    projectPath: string,
    side: "--ours" | "--theirs",
    path: string,
  ): void {
    const out = Bun.spawnSync({
      cmd: ["git", "-C", projectPath, "checkout", side, "--", path],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode !== 0) {
      throw new SnapshotError(
        "ERR_GIT_COMMAND_FAILED",
        out.stderr.toString().trim() || "git checkout failed",
        {
          projectPath,
          side,
          path,
        },
      );
    }
  }

  private stage(projectPath: string, path: string): void {
    const out = Bun.spawnSync({
      cmd: ["git", "-C", projectPath, "add", "--", path],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode !== 0) {
      throw new SnapshotError(
        "ERR_GIT_COMMAND_FAILED",
        out.stderr.toString().trim() || "git add failed",
        {
          projectPath,
          path,
        },
      );
    }
  }

  private readConflictStageText(
    projectPath: string,
    path: string,
    stage: 2 | 3,
  ): string {
    const out = Bun.spawnSync({
      cmd: ["git", "-C", projectPath, "show", `:${stage}:${path}`],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode !== 0) {
      return `Unavailable stage ${stage} content for ${path}`;
    }
    const text = out.stdout.toString();
    return text.length > 0 ? text : "(empty)";
  }

  private readWorkingTreeText(projectPath: string, path: string): string {
    const abs = join(projectPath, path);
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return "(unable to read working tree file)";
    }
  }

  private writeMergedText(
    projectPath: string,
    path: string,
    text: string,
  ): void {
    const abs = join(projectPath, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }

  async handleMultiWorkspaceConflicts(
    projectPath: string,
    workspaces: Array<{
      workspaceId: string;
      workspacePath: string;
      label: string;
    }>,
  ): Promise<{ resolved: boolean; unresolvedPaths: string[] }> {
    const unresolved = this.git.unresolvedConflicts(projectPath);
    if (unresolved.length === 0) {
      return { resolved: true, unresolvedPaths: [] };
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return { resolved: false, unresolvedPaths: unresolved };
    }

    if (unresolved.length === 0) {
      return { resolved: true, unresolvedPaths: [] };
    }

    const items: MultiConflictItem[] = unresolved.map((path) => {
      const workspaceContents = workspaces.map((ws) => ({
        workspaceId: ws.workspaceId,
        label: ws.label,
        content: this.readWorkspaceFileContent(ws.workspacePath, path),
      }));

      return {
        path,
        // Use conflicted working-tree content so conflict markers are available
        // for parseConflictText() in the UI model.
        baseContent: this.readWorkingTreeText(projectPath, path),
        workspaces: workspaceContents,
      };
    });

    const result = await runMultiConflictTui(items);

    if (result.finalized) {
      for (const decision of result.resolutions) {
        if (
          decision.action === "accept" &&
          decision.versionIndex !== undefined
        ) {
          const versionIndex = decision.versionIndex;
          if (versionIndex === 0) {
            this.checkoutSide(projectPath, "--ours", decision.path);
          } else {
            const ws = workspaces[versionIndex - 1];
            if (ws) {
              this.mergeFromWorkspace(
                projectPath,
                ws.workspacePath,
                decision.path,
              );
            }
          }
          this.stage(projectPath, decision.path);
        } else if (decision.action === "manual" && decision.content) {
          this.writeMergedText(projectPath, decision.path, decision.content);
          this.stage(projectPath, decision.path);
        }
      }
    }

    const remaining = this.git.unresolvedConflicts(projectPath);
    return { resolved: remaining.length === 0, unresolvedPaths: remaining };
  }

  private readBaseContent(projectPath: string, path: string): string {
    const out = Bun.spawnSync({
      cmd: ["git", "-C", projectPath, "show", `:1:${path}`],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode !== 0) {
      return "";
    }
    return out.stdout.toString();
  }

  private readWorkspaceFileContent(
    workspacePath: string,
    path: string,
  ): string {
    const abs = join(workspacePath, path);
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return "";
    }
  }

  private mergeFromWorkspace(
    projectPath: string,
    workspacePath: string,
    path: string,
  ): void {
    const abs = join(workspacePath, path);
    const destAbs = join(projectPath, path);
    try {
      const content = readFileSync(abs, "utf8");
      mkdirSync(dirname(destAbs), { recursive: true });
      writeFileSync(destAbs, content, "utf8");
    } catch {}
  }
}
