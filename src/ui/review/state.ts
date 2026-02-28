import type { ReviewDecision } from "../../core/domain/review.js";

export interface ReviewItemState {
  decision: ReviewDecision;
  note: string | null;
}

export type ReviewStateMap = Record<string, ReviewItemState>;

export function createInitialReviewState(paths: string[]): ReviewStateMap {
  return Object.fromEntries(paths.map((path) => [path, { decision: "unreviewed" as ReviewDecision, note: null }])) as ReviewStateMap;
}
