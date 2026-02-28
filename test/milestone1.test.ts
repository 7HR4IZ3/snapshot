import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const createdDirs: string[] = [];

function run(cmd: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function runGit(args: string[], cwd: string): void {
  const res = run(["git", ...args], cwd);
  if (res.code !== 0) {
    throw new Error(`git failed: ${res.stderr || res.stdout}`);
  }
}

function runSnapshot(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  return run([process.execPath, "run", "src/cli.ts", ...args], cwd);
}

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  createdDirs.push(root);
  runGit(["init"], root);
  runGit(["config", "user.email", "test@example.com"], root);
  runGit(["config", "user.name", "Snapshot Test"], root);
  writeFileSync(join(root, "hello.txt"), "hello\n", "utf8");
  runGit(["add", "."], root);
  runGit(["commit", "-m", "init"], root);
  return root;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("snapshot milestone1", () => {
  test("init, spawn, status, diff flow", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-a`;

    const init = runSnapshot(["init", repo], cliRoot);
    expect(init.code).toBe(0);

    const spawn = runSnapshot(["spawn", repo, workspace, "--agent", "agent-1"], cliRoot);
    expect(spawn.code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello from workspace\n", "utf8");

    const status = runSnapshot(["status", workspace, "--json"], cliRoot);
    expect(status.code).toBe(0);
    const statusJson = JSON.parse(status.stdout) as {
      ok: boolean;
      data: { changedFiles: number };
    };
    expect(statusJson.ok).toBe(true);
    expect(statusJson.data.changedFiles).toBeGreaterThan(0);

    const diff = runSnapshot(["diff", workspace], cliRoot);
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain("hello from workspace");

    const backends = runSnapshot(["backends", repo, "--json"], cliRoot);
    expect(backends.code).toBe(0);
    const backendsJson = JSON.parse(backends.stdout) as {
      ok: boolean;
      data: {
        host: {
          worktree: { available: boolean };
          apfsCow: { available: boolean };
          overlay: { available: boolean };
        };
        project: { isGitRepo: boolean; isSnapshotInitialized: boolean } | null;
      };
    };
    expect(backendsJson.ok).toBe(true);
    expect(backendsJson.data.host.worktree.available).toBe(true);
    expect(backendsJson.data.project?.isGitRepo).toBe(true);
    expect(backendsJson.data.project?.isSnapshotInitialized).toBe(true);

    const doctor = runSnapshot(["doctor", repo, "--json"], cliRoot);
    expect(doctor.code).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout) as {
      ok: boolean;
      data: {
        ok: boolean;
        checks: { isGitRepo: boolean; isSnapshotInitialized: boolean; lockPresent: boolean; dirty: boolean };
      };
    };
    expect(doctorJson.ok).toBe(true);
    expect(doctorJson.data.ok).toBe(true);
    expect(doctorJson.data.checks.isGitRepo).toBe(true);
    expect(doctorJson.data.checks.isSnapshotInitialized).toBe(true);
  }, 20000);
});
