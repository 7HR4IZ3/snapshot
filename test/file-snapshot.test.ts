import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runGit(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  return run(["git", ...args], cwd);
}

function expectGitOk(args: string[], cwd: string): void {
  const out = runGit(args, cwd);
  if (out.code !== 0) {
    throw new Error(`git failed: ${out.stderr || out.stdout}`);
  }
}

function runSnapshot(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  return run([process.execPath, "run", join(process.cwd(), "src", "cli.ts"), ...args], cwd);
}

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "snapshot-file-"));
  createdDirs.push(root);
  expectGitOk(["init"], root);
  expectGitOk(["config", "user.email", "test@example.com"], root);
  expectGitOk(["config", "user.name", "Snapshot Test"], root);
  writeFileSync(join(root, "hello.txt"), "hello\nworld\n", "utf8");
  writeFileSync(join(root, "notes.txt"), "alpha\nbeta\n", "utf8");
  expectGitOk(["add", "."], root);
  expectGitOk(["commit", "-m", "init"], root);
  return root;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("snapshot file snapshots", () => {
  test("spawn-file creates a temp copy and pull-file applies it", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const snapshotPath = `${repo}-tmp/hello.ai.txt`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const spawn = runSnapshot(["spawn-file", repo, join(repo, "hello.txt"), snapshotPath, "--json"], cliRoot);
    expect(spawn.code).toBe(0);
    const spawnJson = JSON.parse(spawn.stdout) as {
      ok: boolean;
      data: { fileSnapshotId: string; snapshotPath: string };
    };
    expect(spawnJson.ok).toBe(true);
    expect(spawnJson.data.snapshotPath).toBe(snapshotPath);
    expect(existsSync(snapshotPath)).toBe(true);

    writeFileSync(snapshotPath, "hello from ai\nworld\n", "utf8");

    const pull = runSnapshot(["pull-file", snapshotPath, repo, "--json"], cliRoot);
    expect(pull.code).toBe(0);
    const pullJson = JSON.parse(pull.stdout) as {
      ok: boolean;
      data: { result: string; repoRelativePath: string };
    };
    expect(pullJson.ok).toBe(true);
    expect(pullJson.data.result).toBe("merged");
    expect(pullJson.data.repoRelativePath).toBe("hello.txt");
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("hello from ai\nworld\n");
  }, 20000);

  test("pull-file reports a conflict when project and snapshot both edit the same text", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const snapshotPath = `${repo}-tmp/conflict.ai.txt`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn-file", repo, join(repo, "hello.txt"), snapshotPath], cliRoot).code).toBe(0);

    writeFileSync(join(repo, "hello.txt"), "hello from main\nworld\n", "utf8");
    writeFileSync(snapshotPath, "hello from ai\nworld\n", "utf8");

    const pull = runSnapshot(["pull-file", snapshotPath, repo, "--json"], cliRoot);
    expect(pull.code).toBe(3);
    expect(pull.stdout).toContain("ERR_FILE_SNAPSHOT_CONFLICT");
  }, 20000);

  test("pull-all applies all active file snapshots", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const helloSnapshot = `${repo}-tmp/hello.all.txt`;
    const notesSnapshot = `${repo}-tmp/notes.all.txt`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn-file", repo, join(repo, "hello.txt"), helloSnapshot], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn-file", repo, join(repo, "notes.txt"), notesSnapshot], cliRoot).code).toBe(0);

    writeFileSync(helloSnapshot, "hello\nworld from agent\n", "utf8");
    writeFileSync(notesSnapshot, "alpha changed\nbeta\n", "utf8");

    const pullAll = runSnapshot(["pull-all", repo, "--json"], cliRoot);
    expect(pullAll.code).toBe(0);
    const pullAllJson = JSON.parse(pullAll.stdout) as {
      ok: boolean;
      data: { entries: Array<{ result: string; repoRelativePath: string }> };
    };
    expect(pullAllJson.ok).toBe(true);
    expect(pullAllJson.data.entries).toHaveLength(2);
    expect(pullAllJson.data.entries.map((entry) => entry.result)).toEqual(["merged", "merged"]);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("hello\nworld from agent\n");
    expect(readFileSync(join(repo, "notes.txt"), "utf8")).toBe("alpha changed\nbeta\n");
  }, 20000);
});
