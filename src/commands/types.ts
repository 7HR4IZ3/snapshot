import type { JsonResponse } from "../core/domain/common.js";
import { BackendService } from "../core/services/backend-service.js";
import { FileSnapshotService } from "../core/services/file-snapshot-service.js";
import { MergeService } from "../core/services/merge-service.js";
import { RevertService } from "../core/services/revert-service.js";
import { ReviewService } from "../core/services/review-service.js";
import { WorkspaceService } from "../core/services/workspace-service.js";

export interface CommandContext {
  cwd: string;
  useJson: boolean;
  flags: Record<string, string | boolean>;
  positionals: string[];
  backendService: BackendService;
  fileSnapshotService: FileSnapshotService;
  workspaceService: WorkspaceService;
  mergeService: MergeService;
  revertService: RevertService;
  reviewService: ReviewService;
}

export type CommandResult = JsonResponse | { lines: string[]; reportPath?: string | null };
