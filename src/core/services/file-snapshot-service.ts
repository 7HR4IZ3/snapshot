import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { FileSnapshotRecord } from "../domain/file-snapshot.js";
import { SnapshotError } from "../errors.js";
import { GitService } from "../../infra/git/git-service.js";
import { MetadataStore } from "../../infra/metadata/metadata-store.js";

export interface SpawnFileSnapshotInput {
  projectPath: string;
  sourcePath: string;
  snapshotPath: string;
  agentId?: string;
  label?: string;
}

export interface PullFileSnapshotInput {
  snapshotRef: string;
  projectPath?: string;
  cwd: string;
  force?: boolean;
}

export interface PullAllFileSnapshotsInput {
  projectPath: string;
  cwd: string;
  force?: boolean;
}

export interface PullFileSnapshotResult {
  fileSnapshotId: string;
  repoRelativePath: string;
  sourcePath: string;
  snapshotPath: string;
  result: "merged" | "noop" | "already-applied";
  message: string;
}

export interface PullAllFileSnapshotsEntry {
  fileSnapshotId: string;
  repoRelativePath: string;
  result: "merged" | "noop" | "already-applied" | "conflict";
  message: string;
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  return a.equals(b);
}

function looksBinary(input: Buffer): boolean {
  return input.includes(0);
}

export class FileSnapshotService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
  ) {}

  spawn(input: SpawnFileSnapshotInput): FileSnapshotRecord {
    const projectPath = resolve(input.projectPath);
    const sourcePath = isAbsolute(input.sourcePath) ? input.sourcePath : resolve(projectPath, input.sourcePath);
    const snapshotPath = resolve(input.snapshotPath);

    if (!this.git.isRepo(projectPath)) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "project path is not a git repository", { projectPath });
    }
    if (!this.store.hasConfig(projectPath)) {
      throw new SnapshotError(
        "ERR_PROJECT_NOT_INITIALIZED",
        "project is not initialized, run snapshot init first",
        { projectPath },
      );
    }
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      throw new SnapshotError("ERR_FILE_NOT_FOUND", "source file does not exist", { sourcePath });
    }
    if (sourcePath === snapshotPath) {
      throw new SnapshotError("ERR_USAGE", "snapshot path must differ from source path", {
        sourcePath,
        snapshotPath,
      });
    }
    if (existsSync(snapshotPath)) {
      throw new SnapshotError("ERR_WORKSPACE_PATH_EXISTS", "snapshot path already exists", { snapshotPath });
    }

    const repoRelativePath = relative(projectPath, sourcePath);
    if (!repoRelativePath || repoRelativePath.startsWith("..") || repoRelativePath.startsWith("/")) {
      throw new SnapshotError("ERR_USAGE", "source file must live inside the target project", {
        projectPath,
        sourcePath,
      });
    }

    mkdirSync(dirname(snapshotPath), { recursive: true });

    const fileSnapshotId = this.nextFileSnapshotId();
    const basePath = this.store.fileSnapshotBasePath(projectPath, fileSnapshotId, sourcePath);

    mkdirSync(dirname(basePath), { recursive: true });
    copyFileSync(sourcePath, snapshotPath);
    copyFileSync(sourcePath, basePath);

    const record: FileSnapshotRecord = {
      version: 1,
      fileSnapshotId,
      label: input.label ?? null,
      agentId: input.agentId ?? null,
      projectPath,
      sourcePath,
      repoRelativePath,
      snapshotPath,
      basePath,
      createdAt: new Date().toISOString(),
      status: "active",
      pulledAt: null,
      lastError: null,
    };

    this.store.writeFileSnapshotRecord(projectPath, record);
    return record;
  }

  pull(input: PullFileSnapshotInput): PullFileSnapshotResult {
    const record = this.resolveRecord(input.snapshotRef, input.cwd, input.projectPath);

    if (record.status === "archived") {
      throw new SnapshotError("ERR_FILE_SNAPSHOT_ARCHIVED", "file snapshot is archived", {
        fileSnapshotId: record.fileSnapshotId,
      });
    }
    if (!existsSync(record.snapshotPath)) {
      throw new SnapshotError("ERR_FILE_NOT_FOUND", "snapshot file is missing", {
        fileSnapshotId: record.fileSnapshotId,
        snapshotPath: record.snapshotPath,
      });
    }
    if (!existsSync(record.basePath)) {
      throw new SnapshotError("ERR_METADATA_NOT_FOUND", "file snapshot base file is missing", {
        fileSnapshotId: record.fileSnapshotId,
        basePath: record.basePath,
      });
    }
    if (!existsSync(record.sourcePath)) {
      throw new SnapshotError("ERR_FILE_NOT_FOUND", "source file is missing from project", {
        fileSnapshotId: record.fileSnapshotId,
        sourcePath: record.sourcePath,
      });
    }

    const base = readFileSync(record.basePath);
    const current = readFileSync(record.sourcePath);
    const snapshot = readFileSync(record.snapshotPath);

    let result: PullFileSnapshotResult;

    if (buffersEqual(snapshot, base)) {
      result = {
        fileSnapshotId: record.fileSnapshotId,
        repoRelativePath: record.repoRelativePath,
        sourcePath: record.sourcePath,
        snapshotPath: record.snapshotPath,
        result: "noop",
        message: "snapshot file matches its base copy",
      };
    } else if (buffersEqual(current, snapshot)) {
      result = {
        fileSnapshotId: record.fileSnapshotId,
        repoRelativePath: record.repoRelativePath,
        sourcePath: record.sourcePath,
        snapshotPath: record.snapshotPath,
        result: "already-applied",
        message: "project file already matches snapshot content",
      };
    } else if (buffersEqual(current, base) || input.force) {
      writeFileSync(record.sourcePath, snapshot);
      result = {
        fileSnapshotId: record.fileSnapshotId,
        repoRelativePath: record.repoRelativePath,
        sourcePath: record.sourcePath,
        snapshotPath: record.snapshotPath,
        result: "merged",
        message: input.force ? "snapshot content copied into project with force" : "snapshot content copied into project",
      };
    } else if (looksBinary(base) || looksBinary(current) || looksBinary(snapshot)) {
      this.markConflict(record, "binary content changed in both project and snapshot");
      throw new SnapshotError("ERR_FILE_SNAPSHOT_CONFLICT", "file snapshot pull produced a conflict", {
        fileSnapshotId: record.fileSnapshotId,
        path: record.repoRelativePath,
        message: "binary content changed in both project and snapshot",
      });
    } else {
      const merge = this.git.mergeFile(record.sourcePath, record.basePath, record.snapshotPath);
      if (merge.exitCode === 0) {
        writeFileSync(record.sourcePath, merge.stdout, "utf8");
        result = {
          fileSnapshotId: record.fileSnapshotId,
          repoRelativePath: record.repoRelativePath,
          sourcePath: record.sourcePath,
          snapshotPath: record.snapshotPath,
          result: "merged",
          message: "snapshot changes merged into project file",
        };
      } else if (merge.exitCode === 1) {
        this.markConflict(record, "text merge conflict");
        throw new SnapshotError("ERR_FILE_SNAPSHOT_CONFLICT", "file snapshot pull produced a conflict", {
          fileSnapshotId: record.fileSnapshotId,
          path: record.repoRelativePath,
          message: "text merge conflict",
        });
      } else {
        throw new SnapshotError("ERR_GIT_COMMAND_FAILED", merge.stderr || "git merge-file failed", {
          fileSnapshotId: record.fileSnapshotId,
          stdout: merge.stdout,
          stderr: merge.stderr,
          exitCode: merge.exitCode,
        });
      }
    }

    record.status = "merged";
    record.pulledAt = new Date().toISOString();
    record.lastError = null;
    this.store.writeFileSnapshotRecord(record.projectPath, record);
    return result;
  }

  pullAll(input: PullAllFileSnapshotsInput): { projectPath: string; entries: PullAllFileSnapshotsEntry[] } {
    const projectPath = resolve(input.projectPath);
    const entries: PullAllFileSnapshotsEntry[] = [];
    const records = this.store
      .listFileSnapshotRecords(projectPath)
      .filter((record) => record.status === "active" || record.status === "conflicted")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const record of records) {
      try {
        const pulled = this.pull({
          snapshotRef: record.fileSnapshotId,
          projectPath,
          cwd: input.cwd,
          force: input.force,
        });
        entries.push({
          fileSnapshotId: record.fileSnapshotId,
          repoRelativePath: record.repoRelativePath,
          result: pulled.result,
          message: pulled.message,
        });
      } catch (error) {
        if (error instanceof SnapshotError && error.code === "ERR_FILE_SNAPSHOT_CONFLICT") {
          entries.push({
            fileSnapshotId: record.fileSnapshotId,
            repoRelativePath: record.repoRelativePath,
            result: "conflict",
            message: error.message,
          });
          continue;
        }
        throw error;
      }
    }

    return { projectPath, entries };
  }

  private resolveRecord(snapshotRef: string, cwd: string, explicitProjectPath?: string): FileSnapshotRecord {
    if (explicitProjectPath) {
      const projectPath = resolve(explicitProjectPath);
      return this.store.resolveFileSnapshotRef(projectPath, snapshotRef, cwd);
    }

    const marker = this.store.findWorkspaceMarkerFromCwd(cwd);
    if (marker) {
      return this.store.resolveFileSnapshotRef(marker.projectPath, snapshotRef, cwd);
    }

    const projectPath = this.store.findProjectFromCwd(cwd);
    return this.store.resolveFileSnapshotRef(projectPath, snapshotRef, cwd);
  }

  private markConflict(record: FileSnapshotRecord, message: string): void {
    record.status = "conflicted";
    record.lastError = message;
    this.store.writeFileSnapshotRecord(record.projectPath, record);
  }

  private nextFileSnapshotId(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6);
    return `fs_${stamp}_${random}`;
  }
}
