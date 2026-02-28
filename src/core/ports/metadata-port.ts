import type { MergeSessionRecord } from "../domain/merge.js";
import type { ReviewRecord } from "../domain/review.js";
import type { SnapshotConfig, WorkspaceMarker, WorkspaceRecord } from "../domain/workspace.js";

export interface MetadataPort {
  ensureProjectLayout(projectPath: string): void;
  hasConfig(projectPath: string): boolean;
  loadConfig(projectPath: string): SnapshotConfig;
  writeConfig(projectPath: string, config: SnapshotConfig): void;
  loadWorkspaceRecord(projectPath: string, workspaceId: string): WorkspaceRecord;
  writeWorkspaceRecord(projectPath: string, record: WorkspaceRecord): void;
  listWorkspaceRecords(projectPath: string): WorkspaceRecord[];
  writeWorkspaceMarker(workspacePath: string, marker: WorkspaceMarker): void;
  loadWorkspaceMarker(workspacePath: string): WorkspaceMarker;
  writeMergeSession(projectPath: string, session: MergeSessionRecord): void;
  writeReviewRecord(projectPath: string, review: ReviewRecord): void;
}
