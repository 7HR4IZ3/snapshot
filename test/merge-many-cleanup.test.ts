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
  const root = mkdtempSync(join(tmpdir(), "snapshot-many-"));
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

describe("snapshot merge-many and cleanup", () => {
  test("merge-many created ordering is deterministic", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const ws1 = `${repo}-ws-order-1`;
    const ws2 = `${repo}-ws-order-2`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws1], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws2], cliRoot).code).toBe(0);

    writeFileSync(join(ws1, "a.txt"), "a\n", "utf8");
    expectGitOk(["add", "."], ws1);
    expectGitOk(["commit", "-m", "ws1"], ws1);

    writeFileSync(join(ws2, "b.txt"), "b\n", "utf8");
    expectGitOk(["add", "."], ws2);
    expectGitOk(["commit", "-m", "ws2"], ws2);

    const mergeMany = runSnapshot(
      ["merge-many", repo, "--from", `${ws2},${ws1}`, "--order", "created", "--json"],
      cliRoot,
    );

    expect(mergeMany.code).toBe(0);
    const json = JSON.parse(mergeMany.stdout) as {
      ok: boolean;
      data: { entries: Array<{ workspaceId: string; result: string }>; mode: string };
    };

    expect(json.ok).toBe(true);
    expect(json.data.mode).toBe("many");
    expect(json.data.entries.length).toBe(2);
    expect(json.data.entries[0]?.result).toBe("merged");
    expect(json.data.entries[1]?.result).toBe("merged");
  }, 20000);

  test("merge-many continues on conflict and writes conflict artifact details", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const ws1 = `${repo}-ws-conflict-1`;
    const ws2 = `${repo}-ws-conflict-2`;
    const ws3 = `${repo}-ws-conflict-3`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws1], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws2], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws3], cliRoot).code).toBe(0);

    writeFileSync(join(ws1, "hello.txt"), "hello one\n", "utf8");
    expectGitOk(["add", "."], ws1);
    expectGitOk(["commit", "-m", "ws1 hello"], ws1);

    expectGitOk(["rm", "hello.txt"], ws2);
    expectGitOk(["commit", "-m", "ws2 hello"], ws2);

    writeFileSync(join(ws3, "extra.txt"), "extra\n", "utf8");
    expectGitOk(["add", "."], ws3);
    expectGitOk(["commit", "-m", "ws3 extra"], ws3);

    const mergeMany = runSnapshot(
      [
        "merge-many",
        repo,
        "--from",
        `${ws1},${ws2},${ws3}`,
        "--order",
        "manual",
        "--continue-on-conflict",
        "--json",
      ],
      cliRoot,
    );

    expect(mergeMany.code).toBe(0);
    const json = JSON.parse(mergeMany.stdout) as {
      ok: boolean;
      data: {
        entries: Array<{
          result: string;
          artifactPath: string | null;
          unresolvedConflicts: Array<{ class: string; guidance: string }>;
        }>;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.data.entries.length).toBe(3);
    expect(json.data.entries[0]?.result).toBe("merged");
    expect(json.data.entries[1]?.result).toBe("conflict");
    expect(json.data.entries[2]?.result).toBe("merged");

    const conflictEntry = json.data.entries[1];
    expect(conflictEntry?.artifactPath).toBeTruthy();
    expect(existsSync(String(conflictEntry?.artifactPath))).toBe(true);
    expect(conflictEntry?.unresolvedConflicts[0]?.class).toBeTruthy();
    expect(conflictEntry?.unresolvedConflicts[0]?.guidance).toContain("stage");

    expect(readFileSync(join(repo, "hello.txt"), "utf8")).toContain("hello one");
    expect(readFileSync(join(repo, "extra.txt"), "utf8")).toContain("extra");
  }, 20000);

  test("merge-many stop-on-conflict marks remaining entries skipped and writes report", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const ws1 = `${repo}-ws-stop-1`;
    const ws2 = `${repo}-ws-stop-2`;
    const ws3 = `${repo}-ws-stop-3`;
    const reportPath = join(repo, "merge-report.json");

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws1], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws2], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, ws3], cliRoot).code).toBe(0);

    writeFileSync(join(ws1, "hello.txt"), "alpha\n", "utf8");
    expectGitOk(["add", "."], ws1);
    expectGitOk(["commit", "-m", "ws1 alpha"], ws1);

    expectGitOk(["rm", "hello.txt"], ws2);
    expectGitOk(["commit", "-m", "ws2 delete"], ws2);

    writeFileSync(join(ws3, "z.txt"), "z\n", "utf8");
    expectGitOk(["add", "."], ws3);
    expectGitOk(["commit", "-m", "ws3 z"], ws3);

    const mergeMany = runSnapshot(
      ["merge-many", repo, "--from", `${ws1},${ws2},${ws3}`, "--stop-on-conflict", "--report", reportPath, "--json"],
      cliRoot,
    );

    expect(mergeMany.code).toBe(3);
    expect(existsSync(reportPath)).toBe(true);

    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      entries: Array<{ result: string }>;
    };

    expect(report.entries.length).toBe(3);
    expect(report.entries[0]?.result).toBe("merged");
    expect(report.entries[1]?.result).toBe("conflict");
    expect(report.entries[2]?.result).toBe("skipped");
  }, 20000);

  test("review readonly returns preview without saving record", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-ws-review`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "review change\n", "utf8");

    const review = runSnapshot(["review", workspace, "--readonly", "--json"], cliRoot);
    expect(review.code).toBe(0);

    const json = JSON.parse(review.stdout) as {
      ok: boolean;
      data: { saved: boolean; preview: Array<{ path: string }> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.saved).toBe(false);
    expect(json.data.preview.length).toBeGreaterThan(0);

    const reviewsDir = join(repo, ".snapshot", "reviews");
    expect(existsSync(reviewsDir)).toBe(true);
    const lsReviews = run(["ls", "-A", reviewsDir], cliRoot);
    expect(lsReviews.stdout.trim()).toBe("");
  }, 20000);

  test("cleanup removes worktree and archives workspace lifecycle", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-ws-cleanup`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    const spawn = runSnapshot(["spawn", repo, workspace, "--json"], cliRoot);
    expect(spawn.code).toBe(0);

    const cleanup = runSnapshot(["cleanup", workspace, "--delete-branch", "--json"], cliRoot);
    expect(cleanup.code).toBe(0);
    expect(existsSync(workspace)).toBe(false);

    const list = runSnapshot(["list", repo, "--json"], cliRoot);
    expect(list.code).toBe(0);
    const json = JSON.parse(list.stdout) as {
      ok: boolean;
      data: { workspaces: Array<{ status: string; changedFiles: number }> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.workspaces.length).toBe(1);
    expect(json.data.workspaces[0]?.status).toBe("archived");
    expect(json.data.workspaces[0]?.changedFiles).toBe(0);
  }, 20000);

  test("review approve-all persists artifact in non-interactive mode", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-ws-approve-all`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    writeFileSync(join(workspace, "hello.txt"), "approve me\n", "utf8");

    const review = runSnapshot(["review", workspace, "--approve-all", "--json"], cliRoot);
    expect(review.code).toBe(0);
    const json = JSON.parse(review.stdout) as {
      ok: boolean;
      data: { saved: boolean; record: { reviewId: string; overallDecision: string } };
    };

    expect(json.ok).toBe(true);
    expect(json.data.saved).toBe(true);
    expect(json.data.record.overallDecision).toBe("approved");
    expect(existsSync(join(repo, ".snapshot", "reviews", `${json.data.record.reviewId}.json`))).toBe(true);
  }, 20000);

  test("merge-many preflight returns eligibility report", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-ws-preflight`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);

    const preflight = runSnapshot(
      ["merge-many", repo, "--from", `${workspace},does-not-exist`, "--preflight", "--json"],
      cliRoot,
    );
    expect(preflight.code).toBe(0);

    const json = JSON.parse(preflight.stdout) as {
      ok: boolean;
      data: { mode: string; entries: Array<{ eligible: boolean }> };
    };

    expect(json.ok).toBe(true);
    expect(json.data.mode).toBe("preflight");
    expect(json.data.entries.length).toBe(2);
    expect(json.data.entries[0]?.eligible).toBe(true);
    expect(json.data.entries[1]?.eligible).toBe(false);
  }, 20000);

  test("cleanup --all-archived purges archived records and unlock --force removes lock", () => {
    const cliRoot = process.cwd();
    const repo = setupRepo();
    const workspace = `${repo}-ws-archive-purge`;

    expect(runSnapshot(["init", repo], cliRoot).code).toBe(0);
    expect(runSnapshot(["spawn", repo, workspace], cliRoot).code).toBe(0);
    expect(runSnapshot(["cleanup", workspace, "--json"], cliRoot).code).toBe(0);

    const purge = runSnapshot(["cleanup", repo, "--all-archived", "--json"], cliRoot);
    expect(purge.code).toBe(0);
    const purgeJson = JSON.parse(purge.stdout) as {
      ok: boolean;
      data: { mode: string; removedRecords: number };
    };
    expect(purgeJson.ok).toBe(true);
    expect(purgeJson.data.mode).toBe("all-archived");
    expect(purgeJson.data.removedRecords).toBeGreaterThan(0);

    const lockPath = join(repo, ".snapshot", "locks", "merge.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 99999, hostname: "test", startedAt: new Date().toISOString(), scope: "manual" }),
      "utf8",
    );
    expect(existsSync(lockPath)).toBe(true);

    const unlock = runSnapshot(["unlock", repo, "--force", "--json"], cliRoot);
    expect(unlock.code).toBe(0);
    const unlockJson = JSON.parse(unlock.stdout) as {
      ok: boolean;
      data: { unlocked: boolean };
    };
    expect(unlockJson.ok).toBe(true);
    expect(unlockJson.data.unlocked).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  }, 20000);
});
