import { dirname, relative, resolve } from "node:path";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { WorkspaceBackend, WorkspacePolicy, WorkspaceRecord } from "../domain/workspace.js";
import {
  HARD_EXCLUDED_WORKSPACE_PATHS,
  isWorkspacePathAllowed,
  normalizeWorkspacePattern,
  normalizeWorkspacePolicy,
  workspacePathMatches,
} from "../domain/workspace-policy.js";
import { SnapshotError } from "../errors.js";
import { GitService } from "../../infra/git/git-service.js";
import { MetadataStore, defaultConfig } from "../../infra/metadata/metadata-store.js";

export interface SpawnInput {
  projectPath: string;
  workspacePath: string;
  agentId?: string;
  label?: string;
  fromRef?: string;
  backend?: WorkspaceBackend | "auto";
  strictBackend?: boolean;
  include?: string[];
  exclude?: string[];
  symlink?: string[];
  symlinkMode?: "shared-live" | "safety-restricted";
}

export interface RepairMountsInput {
  projectPath: string;
}

export interface CleanupInput {
  workspaceRef?: string;
  cwd: string;
  projectPath?: string;
  deleteBranch?: boolean;
  force?: boolean;
  allArchived?: boolean;
}

export class WorkspaceService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
  ) {}

  init(projectPath: string, force: boolean): { projectPath: string; configPath: string; created: boolean } {
    const abs = resolve(projectPath);
    if (!this.git.isRepo(abs)) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "path is not a git repository", { projectPath: abs });
    }

    this.store.ensureProjectLayout(abs);
    const configPath = this.store.configPath(abs);
    const exists = this.store.hasConfig(abs);
    if (!exists || force) {
      this.store.writeConfig(abs, defaultConfig(abs));
    }
    this.git.ensureExcluded(abs, ".snapshot/");

    return {
      projectPath: abs,
      configPath,
      created: !exists || force,
    };
  }

  spawn(input: SpawnInput): WorkspaceRecord {
    const projectPath = resolve(input.projectPath);
    const workspacePath = resolve(input.workspacePath);

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
    if (existsSync(workspacePath)) {
      throw new SnapshotError("ERR_WORKSPACE_PATH_EXISTS", "workspace path already exists", { workspacePath });
    }

    const fromRef = input.fromRef ?? "HEAD";
    this.git.verifyRef(projectPath, fromRef);
    const config = this.store.loadConfig(projectPath);

    mkdirSync(dirname(workspacePath), { recursive: true });

    const workspaceId = this.nextWorkspaceId();
    const branch = `snapshot/${workspaceId}`;
    const baseCommit = this.git.verifyRef(projectPath, fromRef);
    const targetBranchAtSpawn = this.git.currentBranch(projectPath);
    const strictBackend = input.strictBackend ?? config.workspace.fallbackPolicy === "error";
    let backend = this.resolveBackend(
      input.backend ?? config.workspace.backendDefault,
      strictBackend,
    );

    if (backend === "worktree") {
      this.git.worktreeAdd(projectPath, workspacePath, branch, fromRef);
    } else if (backend === "apfs-cow") {
      this.git.copyApfsClone(projectPath, workspacePath);
      this.git.checkoutNewBranch(workspacePath, branch, fromRef);
    } else {
      backend = this.spawnOverlayWorkspace(projectPath, workspacePath, branch, fromRef, workspaceId, strictBackend);
    }

    const effectiveInclude = input.include ?? config.workspace.include;
    const effectiveExclude = input.exclude ?? config.workspace.exclude;
    const effectiveSymlink = input.symlink ?? config.workspace.symlink;
    const effectiveSymlinkMode = input.symlinkMode ?? config.workspace.symlinkMode;

    const alwaysExcluded = this.alwaysExcludedPaths(projectPath, workspacePath, workspaceId);
    const policy = normalizeWorkspacePolicy({
      include: effectiveInclude,
      exclude: [...effectiveExclude, ...alwaysExcluded],
      symlink: effectiveSymlink,
      symlinkMode: effectiveSymlinkMode,
    });
    this.applyWorkspaceFilters(workspacePath, policy);
    if (backend === "apfs-cow" || backend === "overlay") {
      this.applyWorkspaceSymlinks(
        projectPath,
        workspacePath,
        policy,
      );
    }

    const record: WorkspaceRecord = {
      version: 1,
      workspaceId,
      label: input.label ?? null,
      agentId: input.agentId ?? null,
      projectPath,
      workspacePath,
      workspaceBranch: branch,
      backend,
      baseCommit,
      targetBranchAtSpawn,
      createdAt: new Date().toISOString(),
      status: "active",
      priority: 0,
      lastReviewId: null,
      lastMergeSessionId: null,
      policy,
    };

    this.store.writeWorkspaceRecord(projectPath, record);
    this.store.writeWorkspaceMarker(workspacePath, {
      version: 1,
      workspaceId,
      projectPath,
    });
    this.git.ensureExcluded(workspacePath, ".snapshot-workspace.json");
    this.git.ensureExcluded(workspacePath, ".snapshot/");

    return record;
  }

  private applyWorkspaceFilters(
    workspacePath: string,
    policy: WorkspacePolicy,
  ): void {
    const walk = (absDir: string, relDir: string): void => {
      let names: string[];
      try {
        names = readdirSync(absDir);
      } catch {
        return;
      }

      for (const name of names) {
        const relPath = relDir ? `${relDir}/${name}` : name;
        if (workspacePathMatches(relPath, [".git"])) {
          continue;
        }
        const absPath = resolve(absDir, name);
        let isDir = false;
        try {
          isDir = lstatSync(absPath).isDirectory();
        } catch {
          continue;
        }

        if (workspacePathMatches(relPath, policy.exclude) ||
          (!isDir && policy.include.length > 0 && !workspacePathMatches(relPath, policy.include))) {
          rmSync(absPath, { recursive: true, force: true });
          continue;
        }

        if (isDir) {
          walk(absPath, relPath);
        }
      }
    };

    walk(workspacePath, "");
  }

  private applyWorkspaceSymlinks(
    projectPath: string,
    workspacePath: string,
    policy: WorkspacePolicy,
  ): void {
    const patterns = policy.symlink;
    if (patterns.length === 0) {
      return;
    }

    const matches: string[] = [];

    const walk = (absDir: string, relDir: string): void => {
      let names: string[] = [];
      try {
        names = readdirSync(absDir);
      } catch {
        return;
      }

      for (const name of names) {
        if (!name) {
          continue;
        }
        const relPath = relDir ? `${relDir}/${name}` : name;
        if (workspacePathMatches(relPath, [".git"])) {
          continue;
        }
        const absPath = resolve(absDir, name);
        let isDir = false;
        try {
          isDir = lstatSync(absPath).isDirectory();
        } catch {
          continue;
        }

        if (workspacePathMatches(relPath, policy.exclude) || (!isDir && !isWorkspacePathAllowed(relPath, policy))) {
          continue;
        }

        const directoryAllowed = isDir ? this.directoryPolicyAllows(absPath, relPath, policy) : true;
        if (workspacePathMatches(relPath, patterns)) {
          if (directoryAllowed) {
            matches.push(relPath);
          }
          if (isDir && directoryAllowed) {
            continue;
          }
        }

        if (isDir) {
          walk(absPath, relPath);
        }
      }
    };

    walk(projectPath, "");

    const sorted = [...new Set(matches)].sort((a, b) => a.split("/").length - b.split("/").length);
    const linkedParents: string[] = [];

    for (const relPath of sorted) {
      if (linkedParents.some((parent) => relPath === parent || relPath.startsWith(`${parent}/`))) {
        continue;
      }

      if (policy.symlinkMode === "safety-restricted" && !this.git.isIgnored(projectPath, relPath)) {
        throw new SnapshotError(
          "ERR_SYMLINK_RESTRICTED",
          `refused to symlink tracked path in safety-restricted mode: ${relPath}`,
        );
      }

      const sourcePath = resolve(projectPath, relPath);
      const targetPath = resolve(workspacePath, relPath);
      const sourceIsDir = lstatSync(sourcePath).isDirectory();
      rmSync(targetPath, { recursive: true, force: true });
      mkdirSync(dirname(targetPath), { recursive: true });
      symlinkSync(sourcePath, targetPath, sourceIsDir ? "dir" : "file");
      if (sourceIsDir) {
        linkedParents.push(relPath);
      }
    }
  }

  private directoryPolicyAllows(absDir: string, relDir: string, policy: WorkspacePolicy): boolean {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      return false;
    }

    for (const name of names) {
      const relPath = `${relDir}/${name}`;
      const absPath = resolve(absDir, name);
      let isDir = false;
      try {
        isDir = lstatSync(absPath).isDirectory();
      } catch {
        return false;
      }
      if (workspacePathMatches(relPath, policy.exclude)) {
        return false;
      }
      if (isDir) {
        if (!this.directoryPolicyAllows(absPath, relPath, policy)) {
          return false;
        }
      } else if (!isWorkspacePathAllowed(relPath, policy)) {
        return false;
      }
    }
    return true;
  }

  private alwaysExcludedPaths(projectPath: string, workspacePath: string, workspaceId: string): string[] {
    const hardcoded = HARD_EXCLUDED_WORKSPACE_PATHS.filter((path) => path !== ".git");
    const records = this.store.listWorkspaceRecords(projectPath);
    const dynamic = records
      .map((record) => record.workspacePath)
      .concat(workspacePath)
      .map((path) => {
        const rel = relative(projectPath, path);
        if (rel.startsWith("..") || rel.startsWith("/")) {
          return "";
        }
        return normalizeWorkspacePattern(rel);
      })
      .filter(Boolean);

    const discovered = this.findSpawnedWorkspaceDirectories(projectPath)
      .map((path) => {
        const rel = relative(projectPath, path);
        if (rel.startsWith("..") || rel.startsWith("/")) {
          return "";
        }
        return normalizeWorkspacePattern(rel);
      })
      .filter(Boolean);

    const overlay = [
      normalizeWorkspacePattern(relative(projectPath, resolve(projectPath, ".snapshot", "overlay", workspaceId))),
    ].filter(Boolean);

    return [...new Set([...hardcoded, ...dynamic, ...discovered, ...overlay])];
  }

  private findSpawnedWorkspaceDirectories(projectPath: string): string[] {
    const results: string[] = [];

    const walk = (dir: string, depth: number): void => {
      if (depth > 4) {
        return;
      }

      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }

      if (names.includes(".snapshot-workspace.json")) {
        results.push(dir);
        return;
      }

      for (const name of names) {
        if (name === ".git" || name === "node_modules") {
          continue;
        }
        const child = resolve(dir, name);
        try {
          if (lstatSync(child).isDirectory()) {
            walk(child, depth + 1);
          }
        } catch {
          // ignore unreadable entries
        }
      }
    };

    walk(projectPath, 0);
    return results;
  }

  repairMounts(input: RepairMountsInput): {
    projectPath: string;
    checked: number;
    repaired: number;
    notes: string[];
  } {
    const projectPath = resolve(input.projectPath);
    const overlayRoot = resolve(projectPath, ".snapshot", "overlay");
    if (!existsSync(overlayRoot)) {
      return { projectPath, checked: 0, repaired: 0, notes: ["no overlay state directory"] };
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(overlayRoot);
    } catch {
      entries = [];
    }

    let checked = 0;
    let repaired = 0;
    const notes: string[] = [];

    for (const id of entries) {
      const statePath = resolve(overlayRoot, id, "state.json");
      if (!existsSync(statePath)) {
        continue;
      }
      checked += 1;
      try {
        const state = JSON.parse(readFileSync(statePath, "utf8")) as {
          mounted?: boolean;
          workspacePath?: string;
        };
        const workspacePath = state.workspacePath;
        if (!workspacePath) {
          continue;
        }
        if (!existsSync(workspacePath) && state.mounted) {
          writeFileSync(
            statePath,
            `${JSON.stringify({ ...state, mounted: false, repairedAt: new Date().toISOString() }, null, 2)}\n`,
            "utf8",
          );
          repaired += 1;
          notes.push(`${id}: marked unmounted because workspace path was missing`);
        }
      } catch {
        notes.push(`${id}: invalid overlay state file`);
      }
    }

    return { projectPath, checked, repaired, notes };
  }

  private resolveBackend(requested: WorkspaceBackend | "auto", strict: boolean): WorkspaceBackend {
    const wanted = requested;

    if (wanted === "worktree") {
      return "worktree";
    }

    if (wanted === "apfs-cow") {
      if (this.git.supportsApfsClone()) {
        return "apfs-cow";
      }
      if (strict) {
        throw new SnapshotError("ERR_BACKEND_UNAVAILABLE", "requested backend unavailable: apfs-cow");
      }
      return "worktree";
    }

    if (wanted === "overlay") {
      if (this.git.supportsOverlayMount()) {
        return "overlay";
      }
      if (this.git.supportsApfsClone()) {
        if (strict) {
          throw new SnapshotError("ERR_BACKEND_UNAVAILABLE", "requested backend unavailable: overlay");
        }
        return "apfs-cow";
      }
      if (strict) {
        throw new SnapshotError("ERR_BACKEND_UNAVAILABLE", "requested backend unavailable: overlay");
      }
      return "worktree";
    }

    if (this.git.supportsApfsClone()) {
      return "apfs-cow";
    }
    return "worktree";
  }

  status(workspaceRef: string, cwd: string): {
    record: WorkspaceRecord;
    headSha: string;
    changes: ReturnType<GitService["diffNameStatus"]>;
    reviewStatus: "not_reviewed" | "in_review" | "approved" | "rejected";
  } {
    const resolved = this.store.resolveWorkspaceRef(workspaceRef, cwd);
    const record = this.store.loadWorkspaceRecord(resolved.projectPath, resolved.workspaceId);
    const headSha = this.git.headSha(record.workspacePath);
    const changes = this.git.diffNameStatus(record.workspacePath, record.baseCommit);

    let reviewStatus: "not_reviewed" | "in_review" | "approved" | "rejected" = "not_reviewed";
    if (record.lastReviewId) {
      const review = this.store.loadReviewRecord(record.projectPath, record.lastReviewId);
      reviewStatus = review.overallDecision;
    }

    return { record, headSha, changes, reviewStatus };
  }

  diff(
    workspaceRef: string,
    cwd: string,
    mode: "name-only" | "patch" | "stat",
    overrideBase?: string,
  ): { record: WorkspaceRecord; output: string | ReturnType<GitService["diffNameStatus"]> } {
    const resolved = this.store.resolveWorkspaceRef(workspaceRef, cwd);
    const record = this.store.loadWorkspaceRecord(resolved.projectPath, resolved.workspaceId);
    const base = overrideBase ?? record.baseCommit;
    this.git.verifyRef(record.workspacePath, base);

    if (mode === "name-only") {
      return { record, output: this.git.diffNameStatus(record.workspacePath, base) };
    }

    if (mode === "stat") {
      const out = Bun.spawnSync({
        cmd: ["git", "-C", record.workspacePath, "diff", "--stat", base],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (out.exitCode !== 0) {
        throw new SnapshotError("ERR_GIT_COMMAND_FAILED", out.stderr.toString().trim() || "git diff failed");
      }
      return { record, output: out.stdout.toString().trim() };
    }

    return { record, output: this.git.diffPatch(record.workspacePath, base) };
  }

  list(projectPath: string, cwd?: string): Array<{
    workspaceId: string;
    workspacePath: string;
    workspaceBranch: string;
    backend: WorkspaceRecord["backend"];
    status: WorkspaceRecord["status"];
    createdAt: string;
    agentId: string | null;
    label: string | null;
    changedFiles: number;
  }> {
    const project = resolve(projectPath);
    const marker = cwd ? this.store.findWorkspaceMarkerFromCwd(cwd) : null;
    const effectiveProject = marker?.projectPath ?? project;
    if (!this.git.isRepo(effectiveProject)) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "path is not a git repository", {
        projectPath: effectiveProject,
      });
    }
    if (!this.store.hasConfig(effectiveProject)) {
      throw new SnapshotError(
        "ERR_PROJECT_NOT_INITIALIZED",
        "project is not initialized, run snapshot init first",
        { projectPath: effectiveProject },
      );
    }

    const records = this.store
      .listWorkspaceRecords(effectiveProject)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return records.map((record) => ({
      workspaceId: record.workspaceId,
      workspacePath: record.workspacePath,
      workspaceBranch: record.workspaceBranch,
      backend: record.backend,
      status: record.status,
      createdAt: record.createdAt,
      agentId: record.agentId,
      label: record.label,
      changedFiles:
        record.status === "archived" || !existsSync(record.workspacePath)
          ? 0
          : this.git.diffNameStatus(record.workspacePath, record.baseCommit).length,
    }));
  }

  cleanup(input: CleanupInput): {
    mode: "single" | "all-archived";
    workspaceId?: string;
    workspacePath?: string;
    branch?: string;
    branchDeleted?: boolean;
    archived?: boolean;
    removedRecords?: number;
  } {
    if (input.allArchived) {
      const marker = this.store.findWorkspaceMarkerFromCwd(input.cwd);
      const projectPath = input.projectPath ? resolve(input.projectPath) : marker?.projectPath ?? this.store.findProjectFromCwd(input.cwd);
      const records = this.store.listWorkspaceRecords(projectPath);
      const archived = records.filter((record) => record.status === "archived");
      for (const record of archived) {
        this.store.removeWorkspaceRecord(projectPath, record.workspaceId);
      }
      return {
        mode: "all-archived",
        removedRecords: archived.length,
      };
    }

    if (!input.workspaceRef) {
      throw new SnapshotError("ERR_USAGE", "cleanup requires a workspace-ref or --all-archived");
    }

    const resolved = this.store.resolveWorkspaceRef(input.workspaceRef, input.cwd);
    const record = this.store.loadWorkspaceRecord(resolved.projectPath, resolved.workspaceId);

    this.assertSafeWorkspacePath(record.projectPath, record.workspacePath);

    if (record.backend === "worktree") {
      this.git.worktreeRemove(record.projectPath, record.workspacePath, input.force ?? false);
      this.store.removeWorkspaceMarker(record.workspacePath);
    } else {
      if (record.backend === "overlay") {
        const overlayRoot = resolve(record.projectPath, ".snapshot", "overlay", record.workspaceId);
        const statePath = resolve(overlayRoot, "state.json");
        if (existsSync(statePath)) {
          try {
            const state = JSON.parse(readFileSync(statePath, "utf8")) as { mounted?: boolean; workspacePath?: string };
            if (state.mounted && state.workspacePath) {
              const unmount = Bun.spawnSync({ cmd: ["umount", state.workspacePath], stdout: "pipe", stderr: "pipe" });
              if (unmount.exitCode !== 0) {
                throw new SnapshotError(
                  "ERR_CLEANUP_FAILED",
                  unmount.stderr.toString().trim() || "could not unmount overlay workspace",
                  { workspaceId: record.workspaceId, workspacePath: state.workspacePath },
                );
              }
            }
          } catch (error) {
            if (error instanceof SnapshotError) {
              throw error;
            }
            throw new SnapshotError("ERR_CLEANUP_FAILED", "could not read overlay state during cleanup", {
              workspaceId: record.workspaceId,
            });
          }
        }
        rmSync(overlayRoot, { recursive: true, force: true });
      }
      rmSync(record.workspacePath, { recursive: true, force: true });
    }

    let branchDeleted = false;
    if (input.deleteBranch ?? false) {
      if (record.backend === "worktree" || record.backend === "overlay") {
        this.git.branchDelete(record.projectPath, record.workspaceBranch, input.force ?? false);
        branchDeleted = true;
      } else {
        branchDeleted = true;
      }
    }

    record.status = "archived";
    this.store.writeWorkspaceRecord(record.projectPath, record);

    return {
      mode: "single",
      workspaceId: record.workspaceId,
      workspacePath: record.workspacePath,
      branch: record.workspaceBranch,
      branchDeleted,
      archived: true,
    };
  }

  private nextWorkspaceId(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6);
    return `ws_${stamp}_${random}`;
  }

  private spawnOverlayWorkspace(
    projectPath: string,
    workspacePath: string,
    branch: string,
    fromRef: string,
    workspaceId: string,
    strictBackend: boolean,
  ): WorkspaceBackend {
    const overlayRoot = resolve(projectPath, ".snapshot", "overlay", workspaceId);
    const upper = resolve(overlayRoot, "upper");
    const work = resolve(overlayRoot, "work");
    mkdirSync(upper, { recursive: true });
    mkdirSync(work, { recursive: true });
    mkdirSync(workspacePath, { recursive: true });

    let mounted = false;
    const mountAttempt = Bun.spawnSync({
      cmd: [
        "mount",
        "-t",
        "overlay",
        "overlay",
        "-o",
        `lowerdir=${projectPath},upperdir=${upper},workdir=${work}`,
        workspacePath,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (mountAttempt.exitCode === 0) {
      mounted = true;
      this.git.checkoutNewBranch(workspacePath, branch, fromRef);
    } else {
      if (strictBackend) {
        rmSync(workspacePath, { recursive: true, force: true });
        rmSync(overlayRoot, { recursive: true, force: true });
        throw new SnapshotError(
          "ERR_BACKEND_UNAVAILABLE",
          mountAttempt.stderr.toString().trim() || "overlay mount failed and strict backend was requested",
        );
      }
      rmSync(workspacePath, { recursive: true, force: true });
      rmSync(overlayRoot, { recursive: true, force: true });
      this.git.worktreeAdd(projectPath, workspacePath, branch, fromRef);
      return "worktree";
    }

    writeFileSync(
      resolve(overlayRoot, "state.json"),
      `${JSON.stringify({ mounted, workspacePath, lowerdir: projectPath, upperdir: upper, workdir: work }, null, 2)}\n`,
      "utf8",
    );
    return "overlay";
  }

  private assertSafeWorkspacePath(projectPath: string, workspacePath: string): void {
    const project = resolve(projectPath);
    const workspace = resolve(workspacePath);
    if (workspace === project || workspace === resolve(workspace, "..")) {
      throw new SnapshotError("ERR_UNSAFE_WORKSPACE_PATH", "refused to remove unsafe workspace path", {
        projectPath: project,
        workspacePath: workspace,
      });
    }
    if (existsSync(workspace) && !existsSync(this.store.workspaceMarkerPath(workspace))) {
      throw new SnapshotError("ERR_WORKSPACE_MARKER_MISSING", "refused to remove a path without a Snapshot workspace marker", {
        projectPath: project,
        workspacePath: workspace,
      });
    }
  }
}
