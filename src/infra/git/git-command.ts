export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runGitCommand(args: string[], cwd?: string): GitCommandResult {
  const proc = Bun.spawnSync({
    cmd: cwd ? ["git", "-C", cwd, ...args] : ["git", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    // Preserve leading spaces: porcelain status uses the first two columns for index/worktree state.
    stdout: proc.stdout.toString().trimEnd(),
    stderr: proc.stderr.toString().trim(),
  };
}
