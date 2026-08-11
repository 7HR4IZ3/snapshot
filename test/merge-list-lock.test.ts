import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  return run([process.execPath, "run", join(process.cwd(), "src", "cli.ts"), ...args], cwd);
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

  test("spawn applies include/exclude filters and always excludes project workspace folders", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-filtered`;

    mkdirSync(join(repo, "keep", "private"), { recursive: true });
    mkdirSync(join(repo, ".spawned", "old-workspace"), { recursive: true });
    writeFileSync(join(repo, "keep", "file.txt"), "keep\n", "utf8");
    writeFileSync(join(repo, "keep", "private", "secret.txt"), "secret\n", "utf8");
    writeFileSync(join(repo, "drop.txt"), "drop\n", "utf8");
    writeFileSync(join(repo, ".spawned", "old-workspace", "old.txt"), "old\n", "utf8");
    mkdirSync(join(repo, "legacy", "spawned-a"), { recursive: true });
    writeFileSync(
      join(repo, "legacy", "spawned-a", ".snapshot-workspace.json"),
      JSON.stringify({ version: 1, workspaceId: "legacy", projectPath: repo }),
      "utf8",
    );
    writeFileSync(join(repo, "legacy", "spawned-a", "legacy.txt"), "legacy\n", "utf8");

    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "add filter fixtures"], repo);
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "workspace.include", "keep/**", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "workspace.exclude", "**/private/**", repo], cliRoot).code).toBe(0);

    const spawn = runSnapshot(["spawn", repo, workspace, "--backend", "apfs-cow", "--json"], cliRoot);
    expect(spawn.code).toBe(0);

    expect(existsSync(join(workspace, "keep", "file.txt"))).toBe(true);
    expect(existsSync(join(workspace, "keep", "private"))).toBe(false);
    expect(existsSync(join(workspace, "drop.txt"))).toBe(false);
    expect(existsSync(join(workspace, ".spawned"))).toBe(false);
    expect(existsSync(join(workspace, ".snapshot"))).toBe(false);
    expect(existsSync(join(workspace, "legacy", "spawned-a"))).toBe(false);
  }, 20000);

  test("apfs-cow symlink patterns support globs with safety modes", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspaceFail = `${repo}-workspace-symlink-fail`;
    const workspaceOk = `${repo}-workspace-symlink-ok`;

    mkdirSync(join(repo, "shared"), { recursive: true });
    mkdirSync(join(repo, "generated"), { recursive: true });
    writeFileSync(join(repo, "shared", "live.txt"), "live\n", "utf8");
    writeFileSync(join(repo, "generated", "tmp.txt"), "tmp\n", "utf8");
    writeFileSync(join(repo, ".gitignore"), "generated/\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "add symlink fixtures"], repo);

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "workspace.symlink", "shared/**", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "workspace.symlinkMode", "safety-restricted", repo], cliRoot).code).toBe(0);

    const failSpawn = runSnapshot(["spawn", repo, workspaceFail, "--backend", "apfs-cow", "--json"], cliRoot);
    expect(failSpawn.code).toBe(1);
    expect(failSpawn.stdout).toContain("ERR_SYMLINK_RESTRICTED");

    expect(runSnapshot(["config", "set", "workspace.symlink", "shared/**,generated/**", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "workspace.symlinkMode", "shared-live", repo], cliRoot).code).toBe(0);

    const okSpawn = runSnapshot(["spawn", repo, workspaceOk, "--backend", "apfs-cow", "--json"], cliRoot);
    expect(okSpawn.code).toBe(0);
    expect(lstatSync(join(workspaceOk, "shared")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workspaceOk, "generated")).isSymbolicLink()).toBe(true);
  }, 20000);

  test("spawn command supports include/exclude/symlink overrides", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-spawn-flags`;

    mkdirSync(join(repo, "pkg", "private"), { recursive: true });
    mkdirSync(join(repo, "generated"), { recursive: true });
    writeFileSync(join(repo, "pkg", "keep.ts"), "export const keep = true;\n", "utf8");
    writeFileSync(join(repo, "pkg", "private", "drop.ts"), "export const drop = true;\n", "utf8");
    writeFileSync(join(repo, "generated", "cache.json"), "{}\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "spawn flags fixtures"], repo);
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const spawn = runSnapshot(
      [
        "spawn",
        repo,
        workspace,
        "--backend",
        "apfs-cow",
        "--include",
        "pkg/**,generated/**",
        "--exclude",
        "**/private/**",
        "--symlink",
        "generated/**",
        "--symlink-mode",
        "shared-live",
        "--json",
      ],
      cliRoot,
    );
    expect(spawn.code).toBe(0);

    expect(existsSync(join(workspace, "pkg", "keep.ts"))).toBe(true);
    expect(existsSync(join(workspace, "pkg", "private"))).toBe(false);
    expect(lstatSync(join(workspace, "generated")).isSymbolicLink()).toBe(true);
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

  test("merge with prefer none reports conflict instead of overriding", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-conflict-none`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "workspace version\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace conflicting change"], workspace);

    writeFileSync(join(repo, "hello.txt"), "project version\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "project conflicting change"], repo);

    const merge = runSnapshot(["merge", workspace, repo, "--prefer", "none", "--json"], cliRoot);
    expect(merge.code).toBe(3);
    expect(merge.stdout).toContain("ERR_MERGE_CONFLICT");
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

  test("filtered workspace merge does not delete excluded tracked files", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-filter-merge`;

    writeFileSync(join(repo, "keep.txt"), "keep base\n", "utf8");
    writeFileSync(join(repo, "excluded.txt"), "must survive\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "filter merge fixtures"], repo);
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace, "--include", "keep.txt", "--json"], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "keep.txt"), "keep changed\n", "utf8");
    const merge = runSnapshot(["merge", workspace, repo, "--json"], cliRoot);
    expect(merge.code).toBe(0);
    expect(readFileSync(join(repo, "keep.txt"), "utf8")).toBe("keep changed\n");
    expect(readFileSync(join(repo, "excluded.txt"), "utf8")).toBe("must survive\n");
  }, 20000);

  test("nested glob includes descend through wildcard directories", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-nested-glob`;

    mkdirSync(join(repo, "packages", "one", "src"), { recursive: true });
    mkdirSync(join(repo, "packages", "one", "test"), { recursive: true });
    writeFileSync(join(repo, "packages", "one", "src", "index.ts"), "export {}\n", "utf8");
    writeFileSync(join(repo, "packages", "one", "test", "index.test.ts"), "test\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "nested glob fixtures"], repo);
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(
      runSnapshot(["spawn", repo, workspace, "--include", "packages/*/src/**", "--json"], cliRoot).code,
    ).toBe(0);

    expect(existsSync(join(workspace, "packages", "one", "src", "index.ts"))).toBe(true);
    expect(existsSync(join(workspace, "packages", "one", "test", "index.test.ts"))).toBe(false);
  }, 20000);

  test("untracked files appear in workspace status", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-untracked`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace, "--json"], cliRoot).code).toBe(0);
    writeFileSync(join(workspace, "new file.txt"), "untracked\n", "utf8");

    const status = runSnapshot(["status", workspace, "--json"], cliRoot);
    expect(status.code).toBe(0);
    const json = JSON.parse(status.stdout) as { data: { changedFiles: number; changes: Array<{ path: string }> } };
    expect(json.data.changedFiles).toBe(1);
    expect(json.data.changes[0]?.path).toBe("new file.txt");

    const review = runSnapshot(["review", workspace, "--readonly", "--json"], cliRoot);
    expect(review.code).toBe(0);
    const reviewJson = JSON.parse(review.stdout) as { data: { preview: Array<{ path: string; hunkCount: number }> } };
    expect(reviewJson.data.preview[0]?.path).toBe("new file.txt");
    expect(reviewJson.data.preview[0]?.hunkCount).toBeGreaterThan(0);
  }, 20000);

  test("global json flag works before the command", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const init = runSnapshot(["--json", "init", repo], cliRoot);
    expect(init.code).toBe(0);
    const json = JSON.parse(init.stdout) as { ok: boolean; command: string };
    expect(json.ok).toBe(true);
    expect(json.command).toBe("init");
  }, 20000);

  test("symlink policy never links the git directory", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-git-symlink`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(
      ["spawn", repo, workspace, "--backend", "apfs-cow", "--symlink", "**", "--symlink-mode", "shared-live", "--json"],
      cliRoot,
    );
    expect(spawn.code).toBe(0);
    const json = JSON.parse(spawn.stdout) as { data: { backend: string } };
    if (json.data.backend === "apfs-cow") {
      expect(lstatSync(join(workspace, ".git")).isSymbolicLink()).toBe(false);
    }
  }, 20000);

  test("directory symlinks cannot bypass excluded descendants", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-symlink-scope`;

    mkdirSync(join(repo, "shared", "private"), { recursive: true });
    writeFileSync(join(repo, "shared", "live.txt"), "live\n", "utf8");
    writeFileSync(join(repo, "shared", "private", "secret.txt"), "secret\n", "utf8");
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "symlink scope fixtures"], repo);
    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);

    const spawn = runSnapshot(
      [
        "spawn",
        repo,
        workspace,
        "--backend",
        "apfs-cow",
        "--exclude",
        "shared/private/**",
        "--symlink",
        "shared/**",
        "--json",
      ],
      cliRoot,
    );
    expect(spawn.code).toBe(0);
    const json = JSON.parse(spawn.stdout) as { data: { backend: string } };
    if (json.data.backend === "apfs-cow") {
      expect(lstatSync(join(workspace, "shared")).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(workspace, "shared", "live.txt")).isSymbolicLink()).toBe(true);
      expect(existsSync(join(workspace, "shared", "private", "secret.txt"))).toBe(false);
    }
  }, 20000);

  test("approved review gates merge without requiring a clean workspace", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-review-gate`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["config", "set", "review.requireApprovalBeforeMerge", "true", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);
    writeFileSync(join(workspace, "hello.txt"), "approved change\n", "utf8");

    expect(runSnapshot(["review", workspace, "--approve-all"], cliRoot).code).toBe(0);
    const merge = runSnapshot(["merge", workspace, repo, "--json"], cliRoot);
    expect(merge.code).toBe(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("approved change\n");
  }, 20000);

  test("single no-commit merge can be reverted after manual git commit", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-workspace-manual-merge`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);
    writeFileSync(join(workspace, "hello.txt"), "manual merge\n", "utf8");
    expectGitOk(["add", "."], workspace);
    expectGitOk(["commit", "-m", "workspace manual merge"], workspace);

    const merge = runSnapshot(["merge", workspace, repo, "--no-commit", "--json"], cliRoot);
    expect(merge.code).toBe(0);
    expectGitOk(["add", "."], repo);
    expectGitOk(["commit", "-m", "complete snapshot merge"], repo);

    const revert = runSnapshot(["revert", repo, "--last", "--json"], cliRoot);
    expect(revert.code).toBe(0);
    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toBe("hello\n");
  }, 20000);
});
