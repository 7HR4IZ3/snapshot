import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  SnapshotConfig,
  WorkspaceMarker,
  WorkspaceRecord,
} from "../../core/domain/workspace.js";
import type { ReviewRecord } from "../../core/domain/review.js";
import type { MergeSessionRecord } from "../../core/domain/merge.js";
import { SnapshotError } from "../../core/errors.js";
import { assertValidConfig, assertValidWorkspaceMarker, assertValidWorkspaceRecord } from "./validator.js";

export const SNAPSHOT_DIR = ".snapshot";
const WORKSPACES_DIR = "workspaces";
const REVIEWS_DIR = "reviews";
const MERGES_DIR = "merges";
const LOCKS_DIR = "locks";
const CONFIG_FILE = "config.json";
const WORKSPACE_MARKER_FILE = ".snapshot-workspace.json";

function atomicWriteJson(path: string, data: unknown): void {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    throw new SnapshotError("ERR_METADATA_NOT_FOUND", "metadata file not found", { path });
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

export class MetadataStore {
  ensureProjectLayout(projectPath: string): void {
    const root = this.snapshotRoot(projectPath);
    mkdirSync(root, { recursive: true });
    mkdirSync(this.workspacesRoot(projectPath), { recursive: true });
    mkdirSync(join(root, REVIEWS_DIR), { recursive: true });
    mkdirSync(join(root, MERGES_DIR), { recursive: true });
    mkdirSync(join(root, LOCKS_DIR), { recursive: true });
  }

  snapshotRoot(projectPath: string): string {
    return join(projectPath, SNAPSHOT_DIR);
  }

  configPath(projectPath: string): string {
    return join(this.snapshotRoot(projectPath), CONFIG_FILE);
  }

  workspacesRoot(projectPath: string): string {
    return join(this.snapshotRoot(projectPath), WORKSPACES_DIR);
  }

  workspaceRecordPath(projectPath: string, workspaceId: string): string {
    return join(this.workspacesRoot(projectPath), `${workspaceId}.json`);
  }

  workspaceRecordPathById(projectPath: string, workspaceId: string): string {
    return this.workspaceRecordPath(projectPath, workspaceId);
  }

  workspaceMarkerPath(workspacePath: string): string {
    return join(workspacePath, WORKSPACE_MARKER_FILE);
  }

  mergeLockPath(projectPath: string): string {
    return join(this.snapshotRoot(projectPath), LOCKS_DIR, "merge.lock");
  }

  mergeSessionPath(projectPath: string, sessionId: string): string {
    return join(this.snapshotRoot(projectPath), MERGES_DIR, `${sessionId}.json`);
  }

  reviewRecordPath(projectPath: string, reviewId: string): string {
    return join(this.snapshotRoot(projectPath), REVIEWS_DIR, `${reviewId}.json`);
  }

  conflictArtifactPath(projectPath: string, sessionId: string, workspaceId: string): string {
    return join(this.snapshotRoot(projectPath), MERGES_DIR, `${sessionId}.${workspaceId}.conflicts.json`);
  }

  hasConfig(projectPath: string): boolean {
    return existsSync(this.configPath(projectPath));
  }

  writeConfig(projectPath: string, config: SnapshotConfig): void {
    this.ensureProjectLayout(projectPath);
    atomicWriteJson(this.configPath(projectPath), config);
  }

  loadConfig(projectPath: string): SnapshotConfig {
    const raw = readJson(this.configPath(projectPath)) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(raw, "workspace")) {
      raw.workspace = {
        backendDefault: "auto",
        fallbackPolicy: "best-available",
        include: [],
        exclude: [],
        symlink: [],
        symlinkMode: "shared-live",
      };
    }
    const workspace = raw.workspace as Record<string, unknown> | undefined;
    if (workspace && !Object.prototype.hasOwnProperty.call(workspace, "include")) {
      workspace.include = [];
    }
    if (workspace && !Object.prototype.hasOwnProperty.call(workspace, "exclude")) {
      workspace.exclude = [];
    }
    if (workspace && !Object.prototype.hasOwnProperty.call(workspace, "symlink")) {
      workspace.symlink = [];
    }
    if (workspace && !Object.prototype.hasOwnProperty.call(workspace, "symlinkMode")) {
      workspace.symlinkMode = "shared-live";
    }
    const merge = raw.merge as Record<string, unknown> | undefined;
    if (merge && !Object.prototype.hasOwnProperty.call(merge, "autoCommit")) {
      merge.autoCommit = true;
    }
    assertValidConfig(raw);
    return raw;
  }

  writeWorkspaceRecord(projectPath: string, record: WorkspaceRecord): void {
    this.ensureProjectLayout(projectPath);
    atomicWriteJson(this.workspaceRecordPath(projectPath, record.workspaceId), record);
  }

  loadWorkspaceRecord(projectPath: string, workspaceId: string): WorkspaceRecord {
    const raw = readJson(this.workspaceRecordPath(projectPath, workspaceId)) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(raw, "backend")) {
      raw.backend = "worktree";
    }
    assertValidWorkspaceRecord(raw);
    return raw;
  }

  listWorkspaceRecords(projectPath: string): WorkspaceRecord[] {
    const root = this.workspacesRoot(projectPath);
    if (!existsSync(root)) {
      return [];
    }

    return readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.loadWorkspaceRecord(projectPath, name.replace(/\.json$/, "")));
  }

  removeWorkspaceRecord(projectPath: string, workspaceId: string): void {
    rmSync(this.workspaceRecordPath(projectPath, workspaceId), { force: true });
  }

  writeWorkspaceMarker(workspacePath: string, marker: WorkspaceMarker): void {
    atomicWriteJson(this.workspaceMarkerPath(workspacePath), marker);
  }

  loadWorkspaceMarker(workspacePath: string): WorkspaceMarker {
    const raw = readJson(this.workspaceMarkerPath(workspacePath));
    assertValidWorkspaceMarker(raw);
    return raw;
  }

  writeMergeSession(projectPath: string, session: MergeSessionRecord): void {
    this.ensureProjectLayout(projectPath);
    atomicWriteJson(this.mergeSessionPath(projectPath, session.mergeSessionId), session);
  }

  loadMergeSession(projectPath: string, mergeSessionId: string): MergeSessionRecord {
    const raw = readJson(this.mergeSessionPath(projectPath, mergeSessionId));
    return raw as MergeSessionRecord;
  }

  listMergeSessions(projectPath: string): MergeSessionRecord[] {
    const root = join(this.snapshotRoot(projectPath), MERGES_DIR);
    if (!existsSync(root)) {
      return [];
    }

    return readdirSync(root)
      .filter((name) => name.endsWith(".json") && !name.includes(".conflicts."))
      .map((name) => name.replace(/\.json$/, ""))
      .map((id) => this.loadMergeSession(projectPath, id));
  }

  writeReviewRecord(projectPath: string, review: ReviewRecord): void {
    this.ensureProjectLayout(projectPath);
    atomicWriteJson(this.reviewRecordPath(projectPath, review.reviewId), review);
  }

  loadReviewRecord(projectPath: string, reviewId: string): ReviewRecord {
    const raw = readJson(this.reviewRecordPath(projectPath, reviewId));
    return raw as ReviewRecord;
  }

  writeConflictArtifact(
    projectPath: string,
    sessionId: string,
    workspaceId: string,
    artifact: unknown,
  ): string {
    this.ensureProjectLayout(projectPath);
    const path = this.conflictArtifactPath(projectPath, sessionId, workspaceId);
    atomicWriteJson(path, artifact);
    return path;
  }

  removeWorkspaceMarker(workspacePath: string): void {
    rmSync(this.workspaceMarkerPath(workspacePath), { force: true });
  }

  resolveWorkspaceRef(ref: string, cwd: string): { projectPath: string; workspaceId: string } {
    const maybePath = resolve(cwd, ref);
    if (existsSync(maybePath)) {
      const markerPath = this.workspaceMarkerPath(maybePath);
      if (!existsSync(markerPath)) {
        const nestedMarker = this.findWorkspaceMarkerFromCwd(maybePath);
        if (nestedMarker) {
          return { projectPath: nestedMarker.projectPath, workspaceId: nestedMarker.workspaceId };
        }
        const projectPath = this.findProjectFromCwd(cwd);
        return { projectPath, workspaceId: ref };
      }
      const marker = this.loadWorkspaceMarker(maybePath);
      return { projectPath: marker.projectPath, workspaceId: marker.workspaceId };
    }

    const cwdWorkspaceMarker = this.findWorkspaceMarkerFromCwd(cwd);
    const projectPath = cwdWorkspaceMarker ? cwdWorkspaceMarker.projectPath : this.findProjectFromCwd(cwd);
    return { projectPath, workspaceId: ref };
  }

  findWorkspaceMarkerFromCwd(cwd: string): WorkspaceMarker | null {
    let current = resolve(cwd);
    for (;;) {
      const markerPath = this.workspaceMarkerPath(current);
      if (existsSync(markerPath)) {
        return this.loadWorkspaceMarker(current);
      }
      const parent = resolve(current, "..");
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  }

  findProjectFromCwd(cwd: string): string {
    let current = resolve(cwd);
    for (;;) {
      const candidate = join(current, SNAPSHOT_DIR);
      if (existsSync(candidate)) {
        return current;
      }
      const parent = resolve(current, "..");
      if (parent === current) {
        break;
      }
      current = parent;
    }

    throw new SnapshotError(
      "ERR_PROJECT_NOT_INITIALIZED",
      "could not find initialized snapshot project from current directory",
      { cwd },
    );
  }
}

export function defaultConfig(projectPath: string): SnapshotConfig {
  return {
    version: 1,
    projectPath,
    workspace: {
      backendDefault: "auto",
      fallbackPolicy: "best-available",
      include: [],
      exclude: [],
      symlink: [],
      symlinkMode: "shared-live",
    },
    merge: {
      prefer: "virtual",
      autoCommit: true,
      stopOnConflict: true,
      allowBinaryAutoResolve: false,
      defaultOrder: "created",
    },
    review: {
      requireApprovalBeforeMerge: false,
    },
  };
}
