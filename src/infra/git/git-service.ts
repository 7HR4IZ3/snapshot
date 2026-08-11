import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SnapshotError } from "../../core/errors.js";
import { runGitCommand } from "./git-command.js";

export interface FileChange {
  status: string;
  path: string;
}

function runGit(args: string[], cwd?: string): string {
  const proc = runGitCommand(args, cwd);
  const stdout = proc.stdout;
  const stderr = proc.stderr;

  if (proc.exitCode !== 0) {
    throw new SnapshotError("ERR_GIT_COMMAND_FAILED", stderr || "git command failed", {
      args,
      cwd,
      stdout,
      stderr,
      exitCode: proc.exitCode,
    });
  }

  return stdout;
}

function runGitRaw(args: string[], cwd?: string): { exitCode: number; stdout: string; stderr: string } {
  return runGitCommand(args, cwd);
}

export interface MergeOptions {
  prefer: "virtual" | "target" | "none";
  commit: boolean;
  message?: string;
}

export interface MergeAttemptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MergeFileAttemptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PorcelainEntry {
  x: string;
  y: string;
  path: string;
}

export class GitService {
  isRepo(path: string): boolean {
    try {
      const output = runGit(["rev-parse", "--is-inside-work-tree"], path);
      return output === "true";
    } catch {
      return false;
    }
  }

  repoRoot(path: string): string {
    return runGit(["rev-parse", "--show-toplevel"], path);
  }

  currentBranch(path: string): string {
    return runGit(["branch", "--show-current"], path);
  }

  headSha(path: string): string {
    return runGit(["rev-parse", "HEAD"], path);
  }

  verifyRef(path: string, ref: string): string {
    return runGit(["rev-parse", ref], path);
  }

  hasUncommittedChanges(path: string): boolean {
    return this.statusPorcelain(path).some((entry) =>
      entry.path !== ".snapshot" && !entry.path.startsWith(".snapshot/"),
    );
  }

  checkout(path: string, branch: string): void {
    runGit(["checkout", branch], path);
  }

  checkoutNewBranch(path: string, branch: string, fromRef: string): void {
    runGit(["checkout", "-b", branch, fromRef], path);
  }

  unresolvedConflicts(path: string): string[] {
    const out = runGit(["diff", "--name-only", "--diff-filter=U"], path);
    if (!out) {
      return [];
    }
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  merge(path: string, sourceBranch: string, options: MergeOptions): MergeAttemptResult {
    const args = ["merge", "--no-ff", "-s", "ort"];
    if (options.prefer === "virtual") {
      args.push("-X", "theirs");
    } else if (options.prefer === "target") {
      args.push("-X", "ours");
    }
    if (!options.commit) {
      args.push("--no-commit");
    }
    if (options.message) {
      args.push("-m", options.message);
    }
    args.push(sourceBranch);
    return runGitRaw(args, path);
  }

  mergeAbort(path: string): void {
    const attempt = runGitRaw(["merge", "--abort"], path);
    if (attempt.exitCode !== 0) {
      throw new SnapshotError("ERR_GIT_COMMAND_FAILED", attempt.stderr || "git merge --abort failed", {
        stdout: attempt.stdout,
        stderr: attempt.stderr,
      });
    }
  }

  isMergeInProgress(path: string): boolean {
    const attempt = runGitRaw(["rev-parse", "-q", "--verify", "MERGE_HEAD"], path);
    return attempt.exitCode === 0;
  }

  firstMergeCommitAfter(path: string, baseRef: string): string | null {
    const output = runGit(["rev-list", "--first-parent", "--merges", "--reverse", `${baseRef}..HEAD`], path);
    return output.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
  }

  mergeFile(currentPath: string, basePath: string, otherPath: string): MergeFileAttemptResult {
    const proc = Bun.spawnSync({
      cmd: ["git", "merge-file", "-p", currentPath, basePath, otherPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }

  revert(path: string, commitSha: string, options?: { mainline?: number; noCommit?: boolean }): MergeAttemptResult {
    const args = ["revert"];
    if (options?.mainline) {
      args.push("-m", String(options.mainline));
    }
    if (options?.noCommit) {
      args.push("--no-commit");
    } else {
      args.push("--no-edit");
    }
    args.push(commitSha);
    return runGitRaw(args, path);
  }

  revertAbort(path: string): void {
    const attempt = runGitRaw(["revert", "--abort"], path);
    if (attempt.exitCode !== 0) {
      throw new SnapshotError("ERR_GIT_COMMAND_FAILED", attempt.stderr || "git revert --abort failed", {
        stdout: attempt.stdout,
        stderr: attempt.stderr,
      });
    }
  }

  statusPorcelain(path: string): PorcelainEntry[] {
    const out = runGit(["status", "--porcelain", "--untracked-files=all"], path);
    if (!out) {
      return [];
    }
    return out
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const x = line[0] ?? " ";
        const y = line[1] ?? " ";
        const pathPart = line.slice(3);
        return { x, y, path: pathPart };
      });
  }

  branchDelete(path: string, branch: string, force: boolean): void {
    runGit(["branch", force ? "-D" : "-d", branch], path);
  }

  worktreeRemove(projectPath: string, workspacePath: string, force: boolean): void {
    runGit(["worktree", "remove", ...(force ? ["--force"] : []), workspacePath], projectPath);
  }

  ensureExcluded(path: string, pattern: string): void {
    const gitPath = runGit(["rev-parse", "--git-path", "info/exclude"], path);
    const excludePath = isAbsolute(gitPath) ? gitPath : resolve(path, gitPath);
    const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    const lines = current.split("\n").map((line) => line.trim());
    if (lines.includes(pattern)) {
      return;
    }
    const next = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${pattern}\n`;
    writeFileSync(excludePath, next, "utf8");
  }

  worktreeAdd(projectPath: string, workspacePath: string, branch: string, fromRef: string): void {
    if (existsSync(workspacePath)) {
      throw new SnapshotError("ERR_WORKSPACE_PATH_EXISTS", "workspace path already exists", {
        workspacePath,
      });
    }
    runGit(["worktree", "add", "-b", branch, workspacePath, fromRef], projectPath);
  }

  copyApfsClone(sourcePath: string, targetPath: string): void {
    if (existsSync(targetPath)) {
      throw new SnapshotError("ERR_WORKSPACE_PATH_EXISTS", "workspace path already exists", {
        workspacePath: targetPath,
      });
    }
    const attempt = runGitCommand(["status"], sourcePath);
    if (attempt.exitCode !== 0) {
      throw new SnapshotError("ERR_NOT_GIT_REPO", "source path is not a git repository", {
        sourcePath,
      });
    }
    const cp = Bun.spawnSync({
      cmd: ["cp", "-cR", sourcePath, targetPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (cp.exitCode !== 0) {
      throw new SnapshotError("ERR_APFS_CLONE_UNSUPPORTED", cp.stderr.toString().trim() || "apfs clone failed", {
        sourcePath,
        targetPath,
      });
    }
  }

  supportsApfsClone(): boolean {
    if (process.platform !== "darwin") {
      return false;
    }

    const sourceDir = mkdtempSync(join(tmpdir(), "snapshot-apfs-support-"));
    const targetDir = `${sourceDir}-clone`;
    try {
      const cp = Bun.spawnSync({
        cmd: ["cp", "-cR", sourceDir, targetDir],
        stdout: "pipe",
        stderr: "pipe",
      });
      return cp.exitCode === 0;
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  }

  supportsOverlayMount(): boolean {
    if (process.platform !== "linux") {
      return false;
    }
    if (typeof process.geteuid === "function" && process.geteuid() !== 0) {
      return false;
    }
    const probe = Bun.spawnSync({
      cmd: ["sh", "-lc", "command -v mount >/dev/null 2>&1"],
      stdout: "pipe",
      stderr: "pipe",
    });
    return probe.exitCode === 0;
  }

  isIgnored(path: string, relPath: string): boolean {
    const out = runGitRaw(["check-ignore", "-q", "--", relPath], path);
    if (out.exitCode === 0) {
      return true;
    }
    if (out.exitCode === 1) {
      return false;
    }
    throw new SnapshotError("ERR_GIT_COMMAND_FAILED", out.stderr || "git check-ignore failed", {
      path,
      relPath,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode,
    });
  }

  isTracked(path: string, relPath: string): boolean {
    const out = runGitRaw(["ls-files", "--error-unmatch", "--", relPath], path);
    return out.exitCode === 0 && out.stdout.trim().length > 0;
  }

  fetchLocalBranch(targetRepoPath: string, sourceRepoPath: string, sourceBranch: string, localRef: string): void {
    runGit(["fetch", sourceRepoPath, `${sourceBranch}:${localRef}`], targetRepoPath);
  }

  diffNameStatus(path: string, baseRef: string, headRef?: string): FileChange[] {
    const range = headRef ? `${baseRef}...${headRef}` : baseRef;
    const output = runGit(["diff", "--name-status", range], path);
    const changes = output
      ? output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return {
          status: status ?? "",
          path: (status?.startsWith("R") || status?.startsWith("C")) && rest.length >= 2
            ? `${rest[0]} -> ${rest[1]}`
            : rest.join("\t"),
        };
      })
      : [];

    if (!headRef) {
      const known = new Set(changes.map((change) => change.path));
      for (const pathPart of this.untrackedFiles(path)) {
        if (!known.has(pathPart)) {
          changes.push({ status: "??", path: pathPart });
        }
      }
    }

    return changes;
  }

  diffPatch(path: string, baseRef: string, headRef?: string): string {
    const range = headRef ? `${baseRef}...${headRef}` : baseRef;
    const trackedPatch = runGit(["diff", range], path);
    if (headRef) {
      return trackedPatch;
    }

    const untrackedPatches = this.untrackedFiles(path).map((relPath) => this.diffUntrackedFile(path, relPath));
    return [trackedPatch, ...untrackedPatches].filter(Boolean).join("\n");
  }

  diffFingerprint(path: string, baseRef: string): string {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(JSON.stringify(this.diffNameStatus(path, baseRef)));
    hasher.update("\n");
    hasher.update(this.diffPatch(path, baseRef));
    return hasher.digest("hex");
  }

  commitScopedChanges(path: string, message: string, isAllowed: (path: string) => boolean): string | null {
    const pending = this.statusPorcelain(path);
    if (pending.length === 0) {
      return null;
    }

    runGit(["add", "-A", "--", "."], path);
    const disallowed = [...new Set(pending.map((entry) => entry.path).filter((entryPath) => !isAllowed(entryPath)))];
    if (disallowed.length > 0) {
      runGit(["reset", "--", ...disallowed], path);
    }

    const staged = Bun.spawnSync({
      cmd: ["git", "-C", path, "diff", "--cached", "--quiet"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (staged.exitCode === 0) {
      return null;
    }

    runGit(["commit", "-m", message], path);
    return this.headSha(path);
  }

  commitAll(path: string, message: string): string {
    runGit(["add", "-A", "--", "."], path);
    runGit(["commit", "-m", message], path);
    return this.headSha(path);
  }

  private untrackedFiles(path: string): string[] {
    const output = runGit(["ls-files", "--others", "--exclude-standard", "-z"], path);
    return output.split("\0").filter(Boolean);
  }

  private diffUntrackedFile(path: string, relPath: string): string {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const attempt = Bun.spawnSync({
      cmd: ["git", "diff", "--no-index", "--", nullDevice, relPath],
      cwd: path,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (attempt.exitCode !== 0 && attempt.exitCode !== 1) {
      throw new SnapshotError("ERR_GIT_COMMAND_FAILED", attempt.stderr.toString().trim() || "git diff failed", {
        path,
        relPath,
        stdout: attempt.stdout.toString(),
        stderr: attempt.stderr.toString(),
        exitCode: attempt.exitCode,
      });
    }
    return attempt.stdout.toString();
  }
}
