import type { JsonResponse } from "../core/domain/common";
import { BackendService } from "../core/services/backend-service";
import { MergeService } from "../core/services/merge-service";
import { RevertService } from "../core/services/revert-service";
import { ReviewService } from "../core/services/review-service";
import { WorkspaceService } from "../core/services/workspace-service";

export interface CommandContext {
  cwd: string;
  useJson: boolean;
  flags: Record<string, string | boolean>;
  positionals: string[];
  backendService: BackendService;
  workspaceService: WorkspaceService;
  mergeService: MergeService;
  revertService: RevertService;
  reviewService: ReviewService;
}

export type CommandResult = JsonResponse | { lines: string[]; reportPath?: string | null };
