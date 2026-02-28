import type { MergeOrder, MergePrefer } from "./merge";

export type WorkspaceBackend = "worktree" | "apfs-cow" | "overlay";

export interface SnapshotConfig {
  version: 1;
  projectPath: string;
  workspace: {
    backendDefault: WorkspaceBackend | "auto";
    fallbackPolicy: "best-available" | "error";
  };
  merge: {
    prefer: MergePrefer;
    autoCommit: boolean;
    stopOnConflict: boolean;
    allowBinaryAutoResolve: boolean;
    defaultOrder: MergeOrder;
  };
  review: {
    requireApprovalBeforeMerge: boolean;
  };
}

export type WorkspaceStatus = "active" | "merged" | "conflicted" | "archived";

export interface WorkspaceRecord {
  version: 1;
  workspaceId: string;
  label: string | null;
  agentId: string | null;
  projectPath: string;
  workspacePath: string;
  workspaceBranch: string;
  backend: WorkspaceBackend;
  baseCommit: string;
  targetBranchAtSpawn: string;
  createdAt: string;
  status: WorkspaceStatus;
  priority: number;
  lastReviewId: string | null;
  lastMergeSessionId: string | null;
}

export interface WorkspaceMarker {
  version: 1;
  workspaceId: string;
  projectPath: string;
}
