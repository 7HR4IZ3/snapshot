import { resolve } from "node:path";
import { SnapshotError } from "../errors.js";
import { GitService } from "../../infra/git/git-service.js";
import { MetadataStore } from "../../infra/metadata/metadata-store.js";

export interface RevertInput {
  projectPath: string;
  mergeSessionId?: string;
  last?: boolean;
  abort?: boolean;
}

export class RevertService {
  constructor(
    private readonly git = new GitService(),
    private readonly store = new MetadataStore(),
  ) {}

  revert(input: RevertInput): {
    mergeSessionId: string;
    revertedCommits: string[];
    targetHead: string;
  } {
    const projectPath = resolve(input.projectPath);
    if (!this.git.isRepo(projectPath)) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "path is not a git repository", { projectPath });
    }

    if (input.abort) {
      this.git.revertAbort(projectPath);
      return {
        mergeSessionId: "abort",
        revertedCommits: [],
        targetHead: this.git.headSha(projectPath),
      };
    }

    if (this.git.hasUncommittedChanges(projectPath)) {
      throw new SnapshotError("ERR_TARGET_DIRTY", "target project has uncommitted changes", { projectPath });
    }

    const mergeSessionId = this.resolveSessionId(projectPath, input);
    const session = this.store.loadMergeSession(projectPath, mergeSessionId);
    const commitShas = session.entries
      .filter((entry) => entry.result === "merged" && Boolean(entry.mergeCommitSha))
      .map((entry) => entry.mergeCommitSha as string)
      .reverse();

    if (commitShas.length === 0 && session.entries.length === 1 && session.entries[0]?.result === "merged") {
      const manualMergeCommit = this.git.firstMergeCommitAfter(projectPath, session.targetStartSha);
      if (manualMergeCommit) {
        commitShas.push(manualMergeCommit);
      }
    }

    if (commitShas.length === 0) {
      throw new SnapshotError("ERR_REVERT_NOTHING_TO_REVERT", "merge session has no revertible commits", {
        mergeSessionId,
      });
    }

    const revertedCommits: string[] = [];
    for (const commitSha of commitShas) {
      const attempt = this.git.revert(projectPath, commitSha, { mainline: 1 });
      const unresolved = this.git.unresolvedConflicts(projectPath);
      if (unresolved.length > 0) {
        throw new SnapshotError("ERR_REVERT_CONFLICT", "revert produced unresolved conflicts", {
          mergeSessionId,
          commitSha,
          unresolvedConflicts: unresolved,
          stdout: attempt.stdout,
          stderr: attempt.stderr,
        });
      }
      if (attempt.exitCode !== 0) {
        throw new SnapshotError("ERR_GIT_COMMAND_FAILED", attempt.stderr || "git revert failed", {
          mergeSessionId,
          commitSha,
          stdout: attempt.stdout,
          stderr: attempt.stderr,
        });
      }
      revertedCommits.push(commitSha);
    }

    return {
      mergeSessionId,
      revertedCommits,
      targetHead: this.git.headSha(projectPath),
    };
  }

  private resolveSessionId(projectPath: string, input: RevertInput): string {
    if (input.mergeSessionId) {
      return input.mergeSessionId;
    }
    if (!input.last) {
      throw new SnapshotError("ERR_USAGE", "revert requires --session <id> or --last");
    }

    const sessions = this.store
      .listMergeSessions(projectPath)
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

    const latest = sessions[0];
    if (!latest) {
      throw new SnapshotError("ERR_REVERT_NOTHING_TO_REVERT", "no merge sessions found");
    }
    return latest.mergeSessionId;
  }
}
