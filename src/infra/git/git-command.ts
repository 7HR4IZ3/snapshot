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
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}
