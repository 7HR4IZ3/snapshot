import type { JsonError, JsonResponse } from "../core/domain/common";
import { SnapshotError } from "../core/errors";

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
