import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { GitService } from "../../infra/git/git-service.js";
import { MetadataStore } from "../../infra/metadata/metadata-store.js";

export interface BackendInspection {
  host: {
    platform: NodeJS.Platform;
    worktree: { available: boolean; reason: string };
    apfsCow: { available: boolean; reason: string };
    overlay: { available: boolean; reason: string };
  };
  project: {
    path: string;
    isGitRepo: boolean;
    isSnapshotInitialized: boolean;
    defaultBackend: "auto" | "worktree" | "apfs-cow" | "overlay";
    workspaceCounts: Record<string, number>;
  } | null;
}

export class BackendService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
  ) {}

  inspect(projectPath?: string): BackendInspection {
    const host = {
      platform: process.platform,
      worktree: { available: true, reason: "git worktree backend is generally available" },
      apfsCow: this.checkApfsCowSupport(),
      overlay: this.checkOverlaySupport(),
    };

    if (!projectPath) {
      return { host, project: null };
    }

    const resolved = resolve(projectPath);
    const isGitRepo = this.git.isRepo(resolved);
    const isSnapshotInitialized = isGitRepo && this.store.hasConfig(resolved);
    const defaultBackend: "auto" | "worktree" | "apfs-cow" | "overlay" = isSnapshotInitialized
      ? this.store.loadConfig(resolved).workspace.backendDefault
      : host.apfsCow.available
        ? "apfs-cow"
        : "worktree";

    const workspaceCounts: Record<string, number> = {
      worktree: 0,
      "apfs-cow": 0,
      overlay: 0,
    };

    if (isSnapshotInitialized) {
      const records = this.store.listWorkspaceRecords(resolved);
      for (const record of records) {
        const key = record.backend;
        workspaceCounts[key] = (workspaceCounts[key] ?? 0) + 1;
      }
    }

    return {
      host,
      project: {
        path: resolved,
        isGitRepo,
        isSnapshotInitialized,
        defaultBackend,
        workspaceCounts,
      },
    };
  }

  private checkApfsCowSupport(): { available: boolean; reason: string } {
    if (process.platform !== "darwin") {
      return { available: false, reason: "APFS CoW clone is macOS-only" };
    }

    const sourceDir = mkdtempSync(join(tmpdir(), "snapshot-apfs-source-"));
    const targetDir = `${sourceDir}-clone`;
    try {
      const attempt = Bun.spawnSync({
        cmd: ["cp", "-cR", sourceDir, targetDir],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (attempt.exitCode === 0) {
        return { available: true, reason: "cp -cR succeeded" };
      }
      return {
        available: false,
        reason: attempt.stderr.toString().trim() || "cp -cR failed",
      };
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  }

  private checkOverlaySupport(): { available: boolean; reason: string } {
    if (process.platform !== "linux") {
      return {
        available: false,
        reason: "overlay mount backend is only auto-detected on Linux in v1",
      };
    }

    const mountProbe = Bun.spawnSync({
      cmd: ["sh", "-lc", "command -v mount >/dev/null 2>&1"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (mountProbe.exitCode !== 0) {
      return { available: false, reason: "mount command not found" };
    }

    return {
      available: true,
      reason: "Linux host with mount command detected (runtime mount still may require permissions)",
    };
  }
}
