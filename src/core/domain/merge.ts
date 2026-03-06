export type MergePrefer = "virtual" | "target" | "none";
export type MergeOrder = "created" | "priority" | "manual";

export type MergeEntryResult = "merged" | "conflict" | "failed" | "skipped";

export type ConflictClass =
  | "text_conflict"
  | "delete_modify_conflict"
  | "rename_conflict"
  | "binary_conflict"
  | "add_add_conflict"
  | "unknown_conflict";

export interface ConflictDetail {
  path: string;
  class: ConflictClass;
  code: string;
  guidance: string;
}

export interface MergeSessionEntry {
  workspaceId: string;
  workspaceBranch: string;
  result: MergeEntryResult;
  mergeCommitSha: string | null;
  autoResolvedTextConflicts: number;
  unresolvedConflicts: ConflictDetail[];
  artifactPath: string | null;
  message?: string;
}

export interface MergeSessionRecord {
  version: 1;
  mergeSessionId: string;
  mode: "single" | "many";
  projectPath: string;
  targetBranch: string;
  targetStartSha: string;
  targetEndSha: string;
  prefer: MergePrefer;
  startedAt: string;
  finishedAt: string;
  entries: MergeSessionEntry[];
}
