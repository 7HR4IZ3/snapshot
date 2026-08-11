import { resolve } from "node:path";
import type {
  ConflictClass,
  ConflictDetail,
  MergeOrder,
  MergePrefer,
  MergeSessionEntry,
  MergeSessionRecord,
} from "../domain/merge.js";
import type { WorkspaceRecord } from "../domain/workspace.js";
import { isWorkspacePathAllowed } from "../domain/workspace-policy.js";
import { SnapshotError } from "../errors.js";
import type { PorcelainEntry } from "../../infra/git/git-service.js";
import { GitService } from "../../infra/git/git-service.js";
import { LockService } from "../../infra/lock/lock-service.js";
import { MetadataStore } from "../../infra/metadata/metadata-store.js";

export interface MergeInput {
  workspaceRef: string;
  projectPath: string;
  cwd: string;
  targetBranch?: string;
  prefer?: MergePrefer;
  commit?: boolean;
  message?: string;
}

export interface MergeManyInput {
  projectPath: string;
  workspaceRefs: string[];
  cwd: string;
  targetBranch?: string;
  prefer?: MergePrefer;
  commit?: boolean;
  message?: string;
  order?: MergeOrder;
  continueOnConflict?: boolean;
}

export interface MergePreflightEntry {
  workspaceRef: string;
  workspaceId: string | null;
  workspaceBranch: string | null;
  eligible: boolean;
  reason: string | null;
}

interface MergeOneResult {
  entry: MergeSessionEntry;
  conflict: boolean;
}

function guidanceFor(className: ConflictClass): string {
  switch (className) {
    case "text_conflict":
      return "Open the file and resolve conflict markers, then complete merge.";
    case "delete_modify_conflict":
      return "Choose whether to keep deletion or modified content, then stage resolution.";
    case "rename_conflict":
      return "Pick the final path/name and stage the resolved file move.";
    case "binary_conflict":
      return "Pick one binary version manually and stage the selected file.";
    case "add_add_conflict":
      return "Combine both added versions or choose one, then stage file.";
    default:
      return "Inspect git status and resolve manually.";
  }
}

function classifyConflict(entry: PorcelainEntry, hasBinaryHint: boolean): ConflictClass {
  const code = `${entry.x}${entry.y}`;
  if (hasBinaryHint) {
    return "binary_conflict";
  }
  if (entry.path.includes("->")) {
    return "rename_conflict";
  }
  if (code === "UU") {
    return "text_conflict";
  }
  if (code === "UD" || code === "DU" || code === "DD") {
    return "delete_modify_conflict";
  }
  if (code === "AA" || code === "AU" || code === "UA") {
    return "add_add_conflict";
  }
  return "unknown_conflict";
}

export class MergeService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
    private readonly locks = new LockService(),
  ) {}

  merge(input: MergeInput): MergeSessionRecord {
    const projectPath = resolve(input.projectPath);
    this.assertMergeReady(projectPath);

    const workspace = this.resolveWorkspaceRecord(projectPath, input.workspaceRef, input.cwd);
    this.store.ensureProjectLayout(projectPath);
    const lockPath = this.store.mergeLockPath(projectPath);
    const scope = `merge:${workspace.workspaceId}`;

    return this.locks.withLock(lockPath, scope, () => {
      this.ensureCleanTarget(projectPath);
      if (input.targetBranch && input.targetBranch !== this.git.currentBranch(projectPath)) {
        this.git.checkout(projectPath, input.targetBranch);
      }

      const targetBranch = this.git.currentBranch(projectPath);
      const targetStartSha = this.git.headSha(projectPath);
      const config = this.store.loadConfig(projectPath);
      const prefer = input.prefer ?? config.merge.prefer;
      const commit = input.commit ?? config.merge.autoCommit;
      const startedAt = new Date().toISOString();
      const sessionId = this.nextMergeSessionId();

      const mergeOne = this.mergeWorkspace(projectPath, workspace, {
        sessionId,
        prefer,
        commit,
        message: input.message,
        rollbackOnConflict: false,
      });

      const targetEndSha = mergeOne.conflict ? targetStartSha : this.git.headSha(projectPath);
      const session: MergeSessionRecord = {
        version: 1,
        mergeSessionId: sessionId,
        mode: "single",
        projectPath,
        targetBranch,
        targetStartSha,
        targetEndSha,
        prefer,
        startedAt,
        finishedAt: new Date().toISOString(),
        entries: [mergeOne.entry],
      };

      this.store.writeMergeSession(projectPath, session);

      if (mergeOne.conflict) {
        throw new SnapshotError("ERR_MERGE_CONFLICT", "merge produced unresolved conflicts", {
          projectPath,
          workspaceId: workspace.workspaceId,
          conflicts: mergeOne.entry.unresolvedConflicts,
          mergeSessionId: sessionId,
          artifactPath: mergeOne.entry.artifactPath,
        });
      }

      return session;
    });
  }

  mergeMany(input: MergeManyInput): MergeSessionRecord {
    const projectPath = resolve(input.projectPath);
    this.assertMergeReady(projectPath);
    if (input.workspaceRefs.length === 0) {
      throw new SnapshotError("ERR_USAGE", "merge-many requires at least one workspace in --from");
    }

    this.store.ensureProjectLayout(projectPath);
    const lockPath = this.store.mergeLockPath(projectPath);
    const scope = `merge-many:${input.workspaceRefs.join(",")}`;

    return this.locks.withLock(lockPath, scope, () => {
      this.ensureCleanTarget(projectPath);
      const config = this.store.loadConfig(projectPath);
      const prefer = input.prefer ?? config.merge.prefer;
      const order = input.order ?? config.merge.defaultOrder;
      const continueOnConflict = input.continueOnConflict ?? !config.merge.stopOnConflict;
      const commit = input.commit ?? config.merge.autoCommit;
      if (!commit && input.workspaceRefs.length > 1) {
        throw new SnapshotError(
          "ERR_USAGE",
          "merge-many --no-commit supports only one workspace; commit or merge workspaces one at a time",
        );
      }
      if (input.targetBranch && input.targetBranch !== this.git.currentBranch(projectPath)) {
        this.git.checkout(projectPath, input.targetBranch);
      }

      const sessionId = this.nextMergeSessionId();
      const startedAt = new Date().toISOString();
      const targetBranch = this.git.currentBranch(projectPath);
      const targetStartSha = this.git.headSha(projectPath);
      const ordered = this.orderWorkspaceRecords(
        projectPath,
        input.workspaceRefs,
        input.cwd,
        order,
      );

      const entries: MergeSessionEntry[] = [];
      let shouldThrowConflict = false;

      for (const workspace of ordered) {
        const mergeOne = this.mergeWorkspace(projectPath, workspace, {
          sessionId,
          prefer,
          commit,
          message: input.message,
          rollbackOnConflict: continueOnConflict,
        });
        entries.push(mergeOne.entry);

        if (mergeOne.conflict && !continueOnConflict) {
          shouldThrowConflict = true;
          const remaining = ordered.slice(entries.length);
          for (const skipped of remaining) {
            entries.push({
              workspaceId: skipped.workspaceId,
              workspaceBranch: skipped.workspaceBranch,
              result: "skipped",
              mergeCommitSha: null,
              autoResolvedTextConflicts: 0,
              unresolvedConflicts: [],
              artifactPath: null,
              message: "skipped after previous conflict",
            });
          }
          break;
        }
      }

      const hasConflict = entries.some((entry) => entry.result === "conflict");
      const session: MergeSessionRecord = {
        version: 1,
        mergeSessionId: sessionId,
        mode: "many",
        projectPath,
        targetBranch,
        targetStartSha,
        targetEndSha: this.git.headSha(projectPath),
        prefer,
        startedAt,
        finishedAt: new Date().toISOString(),
        entries,
      };

      this.store.writeMergeSession(projectPath, session);

      if (shouldThrowConflict || (hasConflict && !continueOnConflict)) {
        throw new SnapshotError("ERR_MERGE_CONFLICT", "merge-many stopped due to conflict", {
          projectPath,
          mergeSessionId: sessionId,
          entries,
        });
      }

      return session;
    });
  }

  preflightMany(input: {
    projectPath: string;
    workspaceRefs: string[];
    cwd: string;
    order?: MergeOrder;
  }): { projectPath: string; order: MergeOrder; entries: MergePreflightEntry[] } {
    const projectPath = resolve(input.projectPath);
    this.assertMergeReady(projectPath);
    const config = this.store.loadConfig(projectPath);
    const order = input.order ?? config.merge.defaultOrder;

    const entries: MergePreflightEntry[] = input.workspaceRefs.map((workspaceRef) => {
      try {
        const record = this.resolveWorkspaceRecord(projectPath, workspaceRef, input.cwd);
        if (record.status === "archived") {
          return {
            workspaceRef,
            workspaceId: record.workspaceId,
            workspaceBranch: record.workspaceBranch,
            eligible: false,
            reason: "workspace archived",
          };
        }

        return {
          workspaceRef,
          workspaceId: record.workspaceId,
          workspaceBranch: record.workspaceBranch,
          eligible: true,
          reason: null,
        };
      } catch (error) {
        return {
          workspaceRef,
          workspaceId: null,
          workspaceBranch: null,
          eligible: false,
          reason: error instanceof Error ? error.message : "unresolved workspace reference",
        };
      }
    });

    if (order !== "manual") {
      entries.sort((a, b) => {
        if (!a.workspaceId || !b.workspaceId) {
          return 0;
        }
        const ra = this.store.loadWorkspaceRecord(projectPath, a.workspaceId);
        const rb = this.store.loadWorkspaceRecord(projectPath, b.workspaceId);
        if (order === "priority") {
          return rb.priority - ra.priority || ra.createdAt.localeCompare(rb.createdAt);
        }
        return ra.createdAt.localeCompare(rb.createdAt);
      });
    }

    return { projectPath, order, entries };
  }

  private mergeWorkspace(
    projectPath: string,
    workspace: WorkspaceRecord,
    options: {
      sessionId: string;
      prefer: MergePrefer;
      commit: boolean;
      message?: string;
      rollbackOnConflict: boolean;
    },
  ): MergeOneResult {
    let autoCommitSha: string | null = null;
    const workspacePending = this.git.statusPorcelain(workspace.workspacePath);
    if (workspacePending.length > 0) {
      autoCommitSha = this.git.commitScopedChanges(
        workspace.workspacePath,
        `snapshot: checkpoint ${options.sessionId} before merge`,
        (path) => isWorkspacePathAllowed(path, workspace.policy),
      );
    }

    const sourceRef = this.resolveMergeSourceRef(projectPath, workspace);
    const sourceChanges = this.git.diffNameStatus(projectPath, workspace.baseCommit, sourceRef);
    const outOfScope = sourceChanges.filter((change) => !isWorkspacePathAllowed(change.path, workspace.policy));
    if (outOfScope.length > 0) {
      throw new SnapshotError("ERR_WORKSPACE_SCOPE_VIOLATION", "workspace contains changes outside its spawn policy", {
        workspaceId: workspace.workspaceId,
        paths: outOfScope.map((change) => change.path),
      });
    }
    const attempt = this.git.merge(projectPath, sourceRef, {
      prefer: options.prefer,
      commit: options.commit,
      message: options.message,
    });

    const porcelain = this.git.statusPorcelain(projectPath);
    const conflictRows = porcelain.filter((row) => row.x === "U" || row.y === "U" || `${row.x}${row.y}` === "AA");
    const hasBinaryHint = `${attempt.stdout}\n${attempt.stderr}`.includes("Cannot merge binary files");

    if (conflictRows.length > 0) {
      const unresolved: ConflictDetail[] = conflictRows.map((row) => {
        const className = classifyConflict(row, hasBinaryHint);
        return {
          path: row.path,
          class: className,
          code: `${row.x}${row.y}`,
          guidance: guidanceFor(className),
        };
      });

      const artifact = {
        version: 1,
        mergeSessionId: options.sessionId,
        workspaceId: workspace.workspaceId,
        workspaceBranch: workspace.workspaceBranch,
        generatedAt: new Date().toISOString(),
        unresolvedConflicts: unresolved,
        git: {
          stdout: attempt.stdout,
          stderr: attempt.stderr,
        },
      };
      const artifactPath = this.store.writeConflictArtifact(
        projectPath,
        options.sessionId,
        workspace.workspaceId,
        artifact,
      );

      workspace.status = "conflicted";
      workspace.lastMergeSessionId = options.sessionId;
      this.store.writeWorkspaceRecord(projectPath, workspace);

      if (options.rollbackOnConflict) {
        this.git.mergeAbort(projectPath);
      }

      return {
        conflict: true,
        entry: {
          workspaceId: workspace.workspaceId,
          workspaceBranch: workspace.workspaceBranch,
          result: "conflict",
          mergeCommitSha: null,
          autoResolvedTextConflicts: 0,
          unresolvedConflicts: unresolved,
          artifactPath,
          message: autoCommitSha
            ? `unresolved conflicts (workspace auto-committed ${autoCommitSha.slice(0, 12)})`
            : "unresolved conflicts",
        },
      };
    }

    if (attempt.exitCode !== 0) {
      if (this.git.isMergeInProgress(projectPath)) {
        this.git.mergeAbort(projectPath);
      }
      workspace.status = "conflicted";
      workspace.lastMergeSessionId = options.sessionId;
      this.store.writeWorkspaceRecord(projectPath, workspace);
      return {
        conflict: true,
        entry: {
          workspaceId: workspace.workspaceId,
          workspaceBranch: workspace.workspaceBranch,
          result: "failed",
          mergeCommitSha: null,
          autoResolvedTextConflicts: 0,
          unresolvedConflicts: [],
          artifactPath: null,
          message: autoCommitSha
            ? `${attempt.stderr || "merge failed"} (workspace auto-committed ${autoCommitSha.slice(0, 12)})`
            : attempt.stderr || "merge failed",
        },
      };
    }

    const mergeCommitSha = options.commit ? this.git.headSha(projectPath) : null;
    workspace.status = "merged";
    workspace.lastMergeSessionId = options.sessionId;
    this.store.writeWorkspaceRecord(projectPath, workspace);

    return {
      conflict: false,
      entry: {
        workspaceId: workspace.workspaceId,
        workspaceBranch: workspace.workspaceBranch,
        result: "merged",
        mergeCommitSha,
        autoResolvedTextConflicts: 0,
        unresolvedConflicts: [],
        artifactPath: null,
        message: autoCommitSha ? `workspace auto-committed ${autoCommitSha.slice(0, 12)}` : undefined,
      },
    };
  }

  private orderWorkspaceRecords(
    projectPath: string,
    workspaceRefs: string[],
    cwd: string,
    order: MergeOrder,
  ): WorkspaceRecord[] {
    const unique = new Map<string, WorkspaceRecord>();
    const manualOrdered: WorkspaceRecord[] = [];

    for (const ref of workspaceRefs) {
      const record = this.resolveWorkspaceRecord(projectPath, ref, cwd);
      if (unique.has(record.workspaceId)) {
        continue;
      }
      unique.set(record.workspaceId, record);
      manualOrdered.push(record);
    }

    if (order === "manual") {
      return manualOrdered;
    }

    const records = [...unique.values()];
    if (order === "priority") {
      return records.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private resolveWorkspaceRecord(projectPath: string, workspaceRef: string, cwd: string): WorkspaceRecord {
    const resolved = this.store.resolveWorkspaceRef(workspaceRef, cwd);
    if (resolved.projectPath !== projectPath) {
      throw new SnapshotError("ERR_WORKSPACE_PROJECT_MISMATCH", "workspace does not belong to target project", {
        workspaceProjectPath: resolved.projectPath,
        projectPath,
      });
    }
    const record = this.store.loadWorkspaceRecord(projectPath, resolved.workspaceId);
    const config = this.store.loadConfig(projectPath);
    if (config.review.requireApprovalBeforeMerge) {
      if (!record.lastReviewId) {
        throw new SnapshotError("ERR_REVIEW_REQUIRED", "workspace requires approved review before merge", {
          workspaceId: record.workspaceId,
        });
      }
      const review = this.store.loadReviewRecord(projectPath, record.lastReviewId);
      if (review.overallDecision !== "approved") {
        throw new SnapshotError("ERR_REVIEW_REQUIRED", "latest review is not approved", {
          workspaceId: record.workspaceId,
          reviewId: review.reviewId,
          overallDecision: review.overallDecision,
        });
      }
      const currentFingerprint = this.git.diffFingerprint(record.workspacePath, record.baseCommit);
      if (!review.reviewedFingerprint || review.reviewedFingerprint !== currentFingerprint) {
        throw new SnapshotError("ERR_REVIEW_REQUIRED", "workspace changed after its last approved review", {
          workspaceId: record.workspaceId,
          reviewId: review.reviewId,
        });
      }
    }
    return record;
  }

  private resolveMergeSourceRef(projectPath: string, workspace: WorkspaceRecord): string {
    if (workspace.backend === "worktree") {
      return workspace.workspaceBranch;
    }

    const importedRef = `refs/snapshot/import/${workspace.workspaceId}`;
    this.git.fetchLocalBranch(projectPath, workspace.workspacePath, workspace.workspaceBranch, importedRef);
    return importedRef;
  }

  private assertMergeReady(projectPath: string): void {
    if (!this.git.isRepo(projectPath)) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "path is not a git repository", { projectPath });
    }
  }

  private ensureCleanTarget(projectPath: string): void {
    if (this.git.hasUncommittedChanges(projectPath)) {
      throw new SnapshotError("ERR_TARGET_DIRTY", "target project has uncommitted changes", {
        projectPath,
      });
    }
  }

  private nextMergeSessionId(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6);
    return `mg_${stamp}_${random}`;
  }
}
