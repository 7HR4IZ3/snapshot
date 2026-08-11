export type ReviewDecision = "unreviewed" | "approved" | "rejected";
export type ReviewOverallDecision = "in_review" | "approved" | "rejected";

export interface ReviewNote {
  message: string;
}

export interface ReviewFileRecord {
  path: string;
  status: string;
  decision: ReviewDecision;
  notes: ReviewNote[];
}

export interface ReviewRecord {
  version: 1;
  reviewId: string;
  workspaceId: string;
  reviewerId: string | null;
  startedAt: string;
  finishedAt: string;
  overallDecision: ReviewOverallDecision;
  files: ReviewFileRecord[];
  reviewedFingerprint?: string;
}
