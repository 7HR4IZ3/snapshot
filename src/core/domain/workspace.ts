import type { MergeOrder, MergePrefer } from "./merge.js";
import type { WorkspacePolicy } from "./workspace-policy.js";

export type { WorkspacePolicy } from "./workspace-policy.js";

export type WorkspaceBackend = "worktree" | "apfs-cow" | "overlay";

export interface SnapshotConfig {
  version: 1;
  projectPath: string;
  workspace: {
    backendDefault: WorkspaceBackend | "auto";
    fallbackPolicy: "best-available" | "error";
    include: string[];
    exclude: string[];
    symlink: string[];
    symlinkMode: "shared-live" | "safety-restricted";
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
  policy: WorkspacePolicy;
}

export interface WorkspaceMarker {
  version: 1;
  workspaceId: string;
  projectPath: string;
}
