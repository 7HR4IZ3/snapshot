import { existsSync } from "node:fs";
import type { CommandContext, CommandResult } from "./types.js";
import { GitService } from "../infra/git/git-service.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { resolveProjectPathFromContext, toJsonResponse } from "./utils.js";

const git = new GitService();
const store = new MetadataStore();

export async function runDoctor(context: CommandContext): Promise<CommandResult> {
  const projectPath = resolveProjectPathFromContext(context.cwd, context.positionals[0]);
  const inspection = context.backendService.inspect(projectPath);
  const isGitRepo = inspection.project?.isGitRepo === true;
  const isSnapshotInitialized = inspection.project?.isSnapshotInitialized === true;

  const lockPath = isSnapshotInitialized ? store.mergeLockPath(projectPath) : null;
  const lockPresent = lockPath ? existsSync(lockPath) : false;
  const dirty = isGitRepo ? git.hasUncommittedChanges(projectPath) : false;

  const repair = context.flags.repair === true ? context.workspaceService.repairMounts({ projectPath }) : null;

  const report = {
    projectPath,
    ok: isGitRepo && isSnapshotInitialized && !lockPresent && !dirty,
    checks: {
      isGitRepo,
      isSnapshotInitialized,
      lockPresent,
      dirty,
    },
    backends: inspection,
    repair,
  };

  if (context.useJson) {
    return toJsonResponse(true, "doctor", report);
  }

  const lines: string[] = [];
  lines.push(`Project: ${projectPath}`);
  lines.push(`Git repo: ${isGitRepo ? "yes" : "no"}`);
  lines.push(`Snapshot initialized: ${isSnapshotInitialized ? "yes" : "no"}`);
  lines.push(`Merge lock present: ${lockPresent ? "yes" : "no"}`);
  lines.push(`Working tree dirty: ${dirty ? "yes" : "no"}`);
  lines.push(`Backend default: ${inspection.project?.defaultBackend ?? "unknown"}`);
  lines.push(`APFS CoW available: ${inspection.host.apfsCow.available ? "yes" : "no"}`);
  lines.push(`Overlay available: ${inspection.host.overlay.available ? "yes" : "no"}`);
  if (repair) {
    lines.push(`Overlay states checked: ${repair.checked}`);
    lines.push(`Overlay states repaired: ${repair.repaired}`);
  }

  return { lines };
}
