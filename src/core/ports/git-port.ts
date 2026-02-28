import type { MergeAttemptResult, MergeOptions, PorcelainEntry } from "../../infra/git/git-service.js";

export interface FileChange {
  status: string;
  path: string;
}

export interface GitPort {
  isRepo(path: string): boolean;
  currentBranch(path: string): string;
  headSha(path: string): string;
  verifyRef(path: string, ref: string): string;
  worktreeAdd(projectPath: string, workspacePath: string, branch: string, fromRef: string): void;
  worktreeRemove(projectPath: string, workspacePath: string, force: boolean): void;
  diffNameStatus(path: string, baseRef: string, headRef?: string): FileChange[];
  diffPatch(path: string, baseRef: string, headRef?: string): string;
  merge(path: string, sourceBranch: string, options: MergeOptions): MergeAttemptResult;
  hasUncommittedChanges(path: string): boolean;
  checkout(path: string, branch: string): void;
  unresolvedConflicts(path: string): string[];
  mergeAbort(path: string): void;
  statusPorcelain(path: string): PorcelainEntry[];
  branchDelete(path: string, branch: string, force: boolean): void;
}
