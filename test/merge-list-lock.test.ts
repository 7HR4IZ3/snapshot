import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runSnapshot(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  return run([process.execPath, "run", "src/cli.ts", ...args], cwd);
}

function expectGitOk(args: string[], cwd: string): void {
  const out = runGit(args, cwd);
  if (out.code !== 0) {
    throw new Error(`git failed: ${out.stderr || out.stdout}`);
  }
}

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "snapshot-merge-"));
  createdDirs.push(root);
  expectGitOk(["init"], root);
  expectGitOk(["config", "user.email", "test@example.com"], root);
  expectGitOk(["config", "user.name", "Snapshot Test"], root);
  writeFileSync(join(root, "hello.txt"), "hello\n", "utf8");
  expectGitOk(["add", "."], root);
  expectGitOk(["commit", "-m", "init"], root);
  return root;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("snapshot merge/list/lock", () => {
  test("merge includes uncommitted workspace changes", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-uncommitted`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello from uncommitted workspace\n", "utf8");

    const merge = runSnapshot(["merge", workspace, repo, "--prefer", "virtual"], cliRoot);
    expect(merge.code).toBe(0);

    const mergedFile = readFileSync(join(repo, "hello.txt"), "utf8");
    expect(mergedFile).toContain("hello from uncommitted workspace");
  }, 20000);

  test("merge honors config autoCommit=false when no commit flag provided", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-no-autocommit`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const configPath = join(repo, ".snapshot", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      merge: { autoCommit: boolean };
    };
    config.merge.autoCommit = false;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello no auto commit\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace no autocommit change"], workspace);

    const headBefore = runGit(["rev-parse", "HEAD"], repo).stdout.trim();
    const merge = runSnapshot(["merge", workspace, repo], cliRoot);
    expect(merge.code).toBe(0);

    const headAfter = runGit(["rev-parse", "HEAD"], repo).stdout.trim();
    expect(headAfter).toBe(headBefore);

    const status = runGit(["status", "--porcelain"], repo).stdout;
    expect(status.length).toBeGreaterThan(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toContain("hello no auto commit");
  }, 20000);

  test("revert last merge session restores previous state", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-revert`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello merged then reverted\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace revert test"], workspace);

    const merge = runSnapshot(["merge", workspace, repo], cliRoot);
    expect(merge.code).toBe(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toContain("hello merged then reverted");

    const revert = runSnapshot(["revert", repo, "--last", "--json"], cliRoot);
    expect(revert.code).toBe(0);
    const revertJson = JSON.parse(revert.stdout) as {
      ok: boolean;
      data: { revertedCommits: string[] };
    };
    expect(revertJson.ok).toBe(true);
    expect(revertJson.data.revertedCommits.length).toBeGreaterThan(0);

    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("hello\n");
  }, 20000);

  test("apfs-cow backend spawn and merge works", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-cow`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(["spawn", repo, workspace, "--backend", "apfs-cow", "--json"], cliRoot);
    expect(spawn.code).toBe(0);
    const spawnJson = JSON.parse(spawn.stdout) as { ok: boolean; data: { backend: string } };
    expect(spawnJson.ok).toBe(true);
    expect(spawnJson.data.backend).toBe("apfs-cow");

    writeFileSync(join(workspace, "hello.txt"), "hello from apfs-cow\n", "utf8");
    const merge = runSnapshot(["merge", workspace, repo], cliRoot);
    expect(merge.code).toBe(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toContain("hello from apfs-cow");
  }, 20000);

  test("overlay backend request spawns and merges with supported fallback", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-overlay`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(["spawn", repo, workspace, "--backend", "overlay", "--json"], cliRoot);
    expect(spawn.code).toBe(0);
    const spawnJson = JSON.parse(spawn.stdout) as { ok: boolean; data: { backend: string } };
    expect(spawnJson.ok).toBe(true);
    expect(["overlay", "apfs-cow", "worktree"]).toContain(spawnJson.data.backend);

    writeFileSync(join(workspace, "hello.txt"), "hello from overlay\n", "utf8");
    const merge = runSnapshot(["merge", workspace, repo], cliRoot);
    expect(merge.code).toBe(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toContain("hello from overlay");
  }, 20000);

  test("strict backend rejects unavailable overlay backend", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-overlay-strict`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(
      ["spawn", repo, workspace, "--backend", "overlay", "--strict-backend", "--json"],
      cliRoot,
    );

    if (process.platform === "linux") {
      expect([0, 1]).toContain(spawn.code);
    } else {
      expect(spawn.code).toBe(1);
      expect(spawn.stdout).toContain("ERR_BACKEND_UNAVAILABLE");
    }
  }, 20000);

  test("auto backend selection creates a valid workspace", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-auto`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(["spawn", repo, workspace, "--backend", "auto", "--json"], cliRoot);
    expect(spawn.code).toBe(0);
    const spawnJson = JSON.parse(spawn.stdout) as {
      ok: boolean;
      data: { backend: string; workspacePath: string };
    };
    expect(spawnJson.ok).toBe(true);
    expect(["worktree", "apfs-cow", "overlay"]).toContain(spawnJson.data.backend);
    expect(spawnJson.data.workspacePath).toBe(workspace);
  }, 20000);

  test("config set/get updates backend and merge autoCommit", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const setBackend = runSnapshot(["config", "set", "workspace.backendDefault", "worktree", repo, "--json"], cliRoot);
    expect(setBackend.code).toBe(0);

    const setAutoCommit = runSnapshot(["config", "set", "merge.autoCommit", "false", repo, "--json"], cliRoot);
    expect(setAutoCommit.code).toBe(0);

    const get = runSnapshot(["config", "get", repo, "--json"], cliRoot);
    expect(get.code).toBe(0);
    const getJson = JSON.parse(get.stdout) as {
      ok: boolean;
      data: {
        config: {
          workspace: { backendDefault: string };
          merge: { autoCommit: boolean };
        };
      };
    };

    expect(getJson.ok).toBe(true);
    expect(getJson.data.config.workspace.backendDefault).toBe("worktree");
    expect(getJson.data.config.merge.autoCommit).toBe(false);
  }, 20000);

  test("repair-mounts command runs successfully", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const repair = runSnapshot(["repair-mounts", repo, "--json"], cliRoot);
    expect(repair.code).toBe(0);
    const json = JSON.parse(repair.stdout) as {
      ok: boolean;
      data: { checked: number; repaired: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.checked).toBeGreaterThanOrEqual(0);
    expect(json.data.repaired).toBeGreaterThanOrEqual(0);
  }, 20000);

  test("merge prefers virtual and list shows workspace", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-b`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace, "--agent", "agent-2"], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello from virtual\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace update"], workspace);

    writeFileSync(join(repo, "hello.txt"), "hello from target\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "target update"], repo);

    const merge = runSnapshot(["merge", workspace, repo, "--prefer", "virtual"], cliRoot);
    expect(merge.code).toBe(0);

    const mergedFile = readFileSync(join(repo, "hello.txt"), "utf8");
    expect(mergedFile).toContain("hello from virtual");

    const list = runSnapshot(["list", repo, "--json"], cliRoot);
    expect(list.code).toBe(0);
    const listJson = JSON.parse(list.stdout) as {
      ok: boolean;
      data: { workspaces: Array<{ status: string }> };
    };
    expect(listJson.ok).toBe(true);
    expect(listJson.data.workspaces.length).toBe(1);
    expect(listJson.data.workspaces[0]?.status).toBe("merged");
  }, 20000);

  test("merge respects lock and exits with code 4", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-c`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "hello lock test\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace lock change"], workspace);

    const lockDir = join(repo, ".snapshot", "locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "merge.lock"),
      JSON.stringify({
        pid: process.pid,
        hostname: "test-host",
        startedAt: new Date().toISOString(),
        scope: "test",
      }),
      "utf8",
    );

    const merge = runSnapshot(["merge", workspace, repo], cliRoot);
    expect(merge.code).toBe(4);
    expect(merge.stderr).toContain("ERR_LOCK_HELD");
  }, 20000);
});
