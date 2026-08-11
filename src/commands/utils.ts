import type { JsonError, JsonResponse } from "../core/domain/common.js";
import { SnapshotError } from "../core/errors.js";
import { MetadataStore } from "../infra/metadata/metadata-store.js";
import { resolve } from "node:path";

const store = new MetadataStore();

export function toJsonResponse(
  ok: boolean,
  command: string,
  data: unknown,
  errors: JsonError[] = [],
): JsonResponse {
  return {
    ok,
    command,
    timestamp: new Date().toISOString(),
    data,
    errors,
  };
}

export function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function projectPathFromContext(
  cwd: string,
  flags: Record<string, string | boolean>,
  legacyPositional?: string,
): string {
  const projectFlag = flags.project;
  if (projectFlag === true || projectFlag === "") {
    throw new SnapshotError("ERR_USAGE", "--project requires a path");
  }
  if (typeof projectFlag === "string" && legacyPositional) {
    throw new SnapshotError("ERR_USAGE", "provide the project path either as --project <path> or as the legacy positional argument, not both");
  }
  return resolveProjectPathFromContext(cwd, typeof projectFlag === "string" ? projectFlag : legacyPositional);
}

export function assertPositional(positionals: string[], index: number, name: string): string {
  const value = positionals[index];
  if (!value) {
    throw new SnapshotError("ERR_USAGE", `missing required argument: ${name}`);
  }
  return value;
}

export function parseCsvFlag(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveProjectPathFromContext(cwd: string, explicit?: string): string {
  if (explicit) {
    const candidate = resolve(cwd, explicit);
    const explicitMarker = store.findWorkspaceMarkerFromCwd(candidate);
    return explicitMarker?.projectPath ?? candidate;
  }

  const marker = store.findWorkspaceMarkerFromCwd(cwd);
  if (marker) {
    return marker.projectPath;
  }

  try {
    return store.findProjectFromCwd(cwd);
  } catch {
    return resolve(cwd);
  }
}

export function isSpawnedWorkspacePath(pathOrCwd: string): boolean {
  const marker = store.findWorkspaceMarkerFromCwd(pathOrCwd);
  return marker !== null;
}
