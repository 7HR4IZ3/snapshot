#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string[], cwd: string): CmdResult {
  const proc = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}

function mustRun(cmd: string[], cwd: string, label: string): CmdResult {
  const out = run(cmd, cwd);
  if (out.code !== 0) {
    throw new Error(`${label} failed: ${out.stderr || out.stdout}`);
  }
  return out;
}

function ensureCleanRepo(repoPath: string): void {
  const out = mustRun(["git", "status", "--porcelain"], repoPath, "git status");
  if (out.stdout.length > 0) {
    throw new Error("target repo must be clean before generating conflict scenario");
  }
}

function runSnapshot(args: string[], snapshotRoot: string): CmdResult {
  return mustRun(["bun", "run", "src/cli.ts", ...args], snapshotRoot, "snapshot command");
}

function parseWorkspaceId(spawnJson: string): string {
  const payload = JSON.parse(spawnJson) as { data: { workspaceId: string } };
  return payload.data.workspaceId;
}

const repoArg = Bun.argv[2];
if (!repoArg) {
  console.error("Usage: bun run scripts/generate-conflicts.ts <repo-path> [target-file]");
  process.exit(2);
}

const targetRepo = resolve(repoArg);
const targetFile = Bun.argv[3] ?? "README.md";
const snapshotRoot = resolve(import.meta.dir, "..");
const workspaceA = `${targetRepo}-snapshot-conflict-a`;
const workspaceB = `${targetRepo}-snapshot-conflict-b`;

if (!existsSync(targetRepo)) {
  console.error(`Repo not found: ${targetRepo}`);
  process.exit(2);
}

ensureCleanRepo(targetRepo);
runSnapshot(["init", targetRepo], snapshotRoot);

if (!existsSync(resolve(targetRepo, targetFile))) {
  writeFileSync(resolve(targetRepo, targetFile), "base line\n", "utf8");
  mustRun(["git", "add", targetFile], targetRepo, "git add baseline file");
  mustRun(["git", "commit", "-m", `Add baseline ${targetFile}`], targetRepo, "git commit baseline file");
}

const spawnA = runSnapshot(["spawn", targetRepo, workspaceA, "--label", "conflict-a", "--json"], snapshotRoot);
const spawnB = runSnapshot(["spawn", targetRepo, workspaceB, "--label", "conflict-b", "--json"], snapshotRoot);
const workspaceIdA = parseWorkspaceId(spawnA.stdout);
const workspaceIdB = parseWorkspaceId(spawnB.stdout);

const original = readFileSync(resolve(targetRepo, targetFile), "utf8");
writeFileSync(resolve(workspaceA, targetFile), `${original}workspace A change\n`, "utf8");
mustRun(["git", "add", targetFile], workspaceA, "git add workspace A");
mustRun(["git", "commit", "-m", `Conflict change A in ${targetFile}`], workspaceA, "git commit workspace A");

writeFileSync(resolve(workspaceB, targetFile), `${original}workspace B change\n`, "utf8");
mustRun(["git", "add", targetFile], workspaceB, "git add workspace B");
mustRun(["git", "commit", "-m", `Conflict change B in ${targetFile}`], workspaceB, "git commit workspace B");

console.log("Conflict scenario generated.");
console.log(`Repo: ${targetRepo}`);
console.log(`File: ${targetFile}`);
console.log(`Workspace A: ${workspaceA} (${workspaceIdA})`);
console.log(`Workspace B: ${workspaceB} (${workspaceIdB})`);
console.log("");
console.log("Try these commands:");
console.log(`bun run src/cli.ts merge-many \"${targetRepo}\" --from \"${workspaceA},${workspaceB}\" --stop-on-conflict --report conflict-report.json`);
console.log(`bun run src/cli.ts merge-many \"${targetRepo}\" --from \"${workspaceA},${workspaceB}\" --continue-on-conflict --report conflict-report.json`);
