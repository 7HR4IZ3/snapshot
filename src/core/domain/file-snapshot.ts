export type FileSnapshotStatus = "active" | "merged" | "conflicted" | "archived";

export interface FileSnapshotRecord {
  version: 1;
  fileSnapshotId: string;
  label: string | null;
  agentId: string | null;
  projectPath: string;
  sourcePath: string;
  repoRelativePath: string;
  snapshotPath: string;
  basePath: string;
  createdAt: string;
  status: FileSnapshotStatus;
  pulledAt: string | null;
  lastError: string | null;
}
