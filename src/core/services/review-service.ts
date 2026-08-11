import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewDecision, ReviewFileRecord, ReviewOverallDecision, ReviewRecord } from "../domain/review.js";
import { SnapshotError } from "../errors.js";
import { GitService } from "../../infra/git/git-service.js";
import { MetadataStore } from "../../infra/metadata/metadata-store.js";
import { runReviewTui } from "../../ui/review/run.js";

export interface ReviewInput {
  workspaceRef: string;
  cwd: string;
  reviewerId?: string;
  exportPath?: string;
  readonly?: boolean;
  approveAll?: boolean;
}

export interface MultiWorkspaceReviewInput {
  projectPath: string;
  cwd: string;
  reviewerId?: string;
  exportPath?: string;
  readonly?: boolean;
  approveAll?: boolean;
}

interface ParsedReviewPatch {
  path: string;
  hunks: string[];
}

function parsePatchByFile(patch: string): ParsedReviewPatch[] {
  const lines = patch.split("\n");
  const files: ParsedReviewPatch[] = [];
  let current: ParsedReviewPatch | null = null;
  let currentHunk: string[] = [];

  const flushHunk = (): void => {
    if (!current || currentHunk.length === 0) {
      return;
    }
    current.hunks.push(currentHunk.join("\n"));
    currentHunk = [];
  };

  const flushFile = (): void => {
    flushHunk();
    if (current) {
      if (current.hunks.length === 0) {
        current.hunks.push("No hunks available.");
      }
      files.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      const bPath = parseDiffHeaderPath(line) ?? "unknown";
      current = { path: bPath, hunks: [] };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunk = [line];
      continue;
    }

    if (currentHunk.length > 0) {
      currentHunk.push(line);
    }
  }

  flushFile();
  return files;
}

function parseDiffHeaderPath(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const firstEnd = findQuotedTokenEnd(rest, 0);
    if (firstEnd < 0) {
      return null;
    }
    const secondStart = rest.slice(firstEnd + 1).search(/\S/);
    if (secondStart < 0) {
      return null;
    }
    const absoluteSecondStart = firstEnd + 1 + secondStart;
    const secondEnd = findQuotedTokenEnd(rest, absoluteSecondStart);
    if (secondEnd < 0) {
      return null;
    }
    return decodeGitPathToken(rest.slice(absoluteSecondStart, secondEnd + 1)).replace(/^b\//, "");
  }

  const separator = rest.lastIndexOf(" b/");
  if (separator < 0) {
    return null;
  }
  return rest.slice(separator + 3);
}

function findQuotedTokenEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      return index;
    }
  }
  return -1;
}

function decodeGitPathToken(token: string): string {
  if (!token.startsWith('"') || !token.endsWith('"')) {
    return token;
  }
  try {
    return JSON.parse(token) as string;
  } catch {
    return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function deriveOverall(files: ReviewFileRecord[]): ReviewOverallDecision {
  if (files.length === 0) {
    return "approved";
  }
  if (files.some((file) => file.decision === "rejected")) {
    return "rejected";
  }
  if (files.every((file) => file.decision === "approved")) {
    return "approved";
  }
  return "in_review";
}

function toMarkdown(record: ReviewRecord): string {
  const lines: string[] = [];
  lines.push(`# Snapshot Review ${record.reviewId}`);
  lines.push("");
  lines.push(`- Workspace: ${record.workspaceId}`);
  lines.push(`- Reviewer: ${record.reviewerId ?? "unknown"}`);
  lines.push(`- Started: ${record.startedAt}`);
  lines.push(`- Finished: ${record.finishedAt}`);
  lines.push(`- Decision: ${record.overallDecision}`);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  for (const file of record.files) {
    lines.push(`- ${file.status} ${file.path}: ${file.decision}`);
    for (const note of file.notes) {
      lines.push(`  - note: ${note.message}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export class ReviewService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
  ) {}

  async review(input: ReviewInput): Promise<{ saved: boolean; record: ReviewRecord | null; preview: unknown }> {
    const resolved = this.store.resolveWorkspaceRef(input.workspaceRef, input.cwd);
    const workspace = this.store.loadWorkspaceRecord(resolved.projectPath, resolved.workspaceId);
    const changes = this.git.diffNameStatus(workspace.workspacePath, workspace.baseCommit);
    const patch = this.git.diffPatch(workspace.workspacePath, workspace.baseCommit);
    const parsedPatch = parsePatchByFile(patch);
    const hunkMap = new Map(parsedPatch.map((item) => [item.path, item.hunks]));

    const preview = changes.map((change) => ({
      path: change.path,
      status: change.status,
      hunkCount: hunkMap.get(change.path)?.length ?? 0,
    }));

    if (input.readonly) {
      return {
        saved: false,
        record: null,
        preview,
      };
    }

    if (input.approveAll) {
      const startedAt = new Date().toISOString();
      const files: ReviewFileRecord[] = changes.map((change) => ({
        path: change.path,
        status: change.status,
        decision: "approved",
        notes: [],
      }));

      const reviewId = this.nextReviewId();
      const record: ReviewRecord = {
        version: 1,
        reviewId,
        workspaceId: workspace.workspaceId,
        reviewerId: input.reviewerId ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        overallDecision: deriveOverall(files),
        files,
        reviewedFingerprint: this.git.diffFingerprint(workspace.workspacePath, workspace.baseCommit),
      };

      this.store.writeReviewRecord(workspace.projectPath, record);
      workspace.lastReviewId = record.reviewId;
      this.store.writeWorkspaceRecord(workspace.projectPath, workspace);

      if (input.exportPath) {
        const exportPath = resolve(input.cwd, input.exportPath);
        writeFileSync(exportPath, toMarkdown(record), "utf8");
      }

      return {
        saved: true,
        record,
        preview,
      };
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new SnapshotError(
        "ERR_REVIEW_TTY_REQUIRED",
        "interactive review requires TTY; use --readonly or --approve-all for non-interactive environments",
      );
    }

    const startedAt = new Date().toISOString();
    const workspaces = [
      {
        workspaceId: workspace.workspaceId,
        workspaceLabel: workspace.label ?? workspace.workspaceId,
        files: changes.map((change) => ({
          path: change.path,
          status: change.status,
          hunks: hunkMap.get(change.path) ?? ["No hunks available."],
        })),
      },
    ];
    const result = await runReviewTui(workspaces);

    if (!result.save) {
      return {
        saved: false,
        record: null,
        preview,
      };
    }

    const files: ReviewFileRecord[] = changes.map((change) => {
      const selected = result.decisions.find(
        (item) => item.workspaceId === workspace.workspaceId && item.path === change.path,
      );
      const decision: ReviewDecision = selected?.decision ?? "unreviewed";
      return {
        path: change.path,
        status: change.status,
        decision,
        notes: selected?.note ? [{ message: selected.note }] : [],
      };
    });

    const reviewId = this.nextReviewId();
    const record: ReviewRecord = {
      version: 1,
      reviewId,
      workspaceId: workspace.workspaceId,
      reviewerId: input.reviewerId ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      overallDecision: deriveOverall(files),
      files,
      reviewedFingerprint: this.git.diffFingerprint(workspace.workspacePath, workspace.baseCommit),
    };

    this.store.writeReviewRecord(workspace.projectPath, record);
    workspace.lastReviewId = record.reviewId;
    this.store.writeWorkspaceRecord(workspace.projectPath, workspace);

    if (input.exportPath) {
      const exportPath = resolve(input.cwd, input.exportPath);
      writeFileSync(exportPath, toMarkdown(record), "utf8");
    }

    return {
      saved: true,
      record,
      preview,
    };
  }

  private nextReviewId(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6);
    return `rv_${stamp}_${random}`;
  }

  async reviewAll(input: MultiWorkspaceReviewInput): Promise<{ saved: boolean; records: ReviewRecord[]; preview: unknown }> {
    const projectPath = input.projectPath || this.store.findProjectFromCwd(input.cwd);
    const workspaceRecords = this.store.listWorkspaceRecords(projectPath).filter((ws) => ws.status === "active");

    if (workspaceRecords.length === 0) {
      throw new SnapshotError("ERR_NO_ACTIVE_WORKSPACES", "No active workspaces found to review");
    }

    const workspaces: Array<{
      workspaceId: string;
      workspaceLabel: string;
      files: Array<{ path: string; status: string; hunks: string[] }>;
    }> = [];

    const preview: Array<{ workspaceId: string; workspaceLabel: string; files: Array<{ path: string; status: string; hunkCount: number }> }> = [];

    for (const ws of workspaceRecords) {
      const changes = this.git.diffNameStatus(ws.workspacePath, ws.baseCommit);
      const patch = this.git.diffPatch(ws.workspacePath, ws.baseCommit);
      const parsedPatch = parsePatchByFile(patch);
      const hunkMap = new Map(parsedPatch.map((item) => [item.path, item.hunks]));

      workspaces.push({
        workspaceId: ws.workspaceId,
        workspaceLabel: ws.label ?? ws.workspaceId,
        files: changes.map((change) => ({
          path: change.path,
          status: change.status,
          hunks: hunkMap.get(change.path) ?? ["No hunks available."],
        })),
      });

      preview.push({
        workspaceId: ws.workspaceId,
        workspaceLabel: ws.label ?? ws.workspaceId,
        files: changes.map((change) => ({
          path: change.path,
          status: change.status,
          hunkCount: hunkMap.get(change.path)?.length ?? 0,
        })),
      });
    }

    if (input.readonly) {
      return {
        saved: false,
        records: [],
        preview,
      };
    }

    if (input.approveAll) {
      const startedAt = new Date().toISOString();
      const records: ReviewRecord[] = [];

      for (const ws of workspaceRecords) {
        const changes = this.git.diffNameStatus(ws.workspacePath, ws.baseCommit);
        const files: ReviewFileRecord[] = changes.map((change) => ({
          path: change.path,
          status: change.status,
          decision: "approved" as ReviewDecision,
          notes: [],
        }));

        const reviewId = this.nextReviewId();
        const record: ReviewRecord = {
          version: 1,
          reviewId,
          workspaceId: ws.workspaceId,
          reviewerId: input.reviewerId ?? null,
          startedAt,
          finishedAt: new Date().toISOString(),
          overallDecision: deriveOverall(files),
          files,
          reviewedFingerprint: this.git.diffFingerprint(ws.workspacePath, ws.baseCommit),
        };

        this.store.writeReviewRecord(ws.projectPath, record);
        ws.lastReviewId = record.reviewId;
        this.store.writeWorkspaceRecord(ws.projectPath, ws);
        records.push(record);
      }

      if (input.exportPath) {
        const exportPath = resolve(input.cwd, input.exportPath);
        writeFileSync(exportPath, records.map(toMarkdown).join("\n"), "utf8");
      }

      return {
        saved: true,
        records,
        preview,
      };
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new SnapshotError(
        "ERR_REVIEW_TTY_REQUIRED",
        "interactive review requires TTY; use --readonly or --approve-all for non-interactive environments",
      );
    }

    const startedAt = new Date().toISOString();
    const result = await runReviewTui(workspaces);

    if (!result.save) {
      return {
        saved: false,
        records: [],
        preview,
      };
    }

    const records: ReviewRecord[] = [];

    for (const ws of workspaceRecords) {
      const changes = this.git.diffNameStatus(ws.workspacePath, ws.baseCommit);
      const files: ReviewFileRecord[] = changes.map((change) => {
        const selected = result.decisions.find(
          (item) => item.workspaceId === ws.workspaceId && item.path === change.path,
        );
        const decision: ReviewDecision = selected?.decision ?? "unreviewed";
        return {
          path: change.path,
          status: change.status,
          decision,
          notes: selected?.note ? [{ message: selected.note }] : [],
        };
      });

      const reviewId = this.nextReviewId();
      const record: ReviewRecord = {
        version: 1,
        reviewId,
        workspaceId: ws.workspaceId,
        reviewerId: input.reviewerId ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        overallDecision: deriveOverall(files),
        files,
        reviewedFingerprint: this.git.diffFingerprint(ws.workspacePath, ws.baseCommit),
      };

      this.store.writeReviewRecord(ws.projectPath, record);
      ws.lastReviewId = record.reviewId;
      this.store.writeWorkspaceRecord(ws.projectPath, ws);
      records.push(record);
    }

    if (input.exportPath) {
      const exportPath = resolve(input.cwd, input.exportPath);
      writeFileSync(exportPath, records.map(toMarkdown).join("\n"), "utf8");
    }

    return {
      saved: true,
      records,
      preview,
    };
  }
}
