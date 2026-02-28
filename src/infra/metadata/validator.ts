import Ajv, { type ErrorObject } from "ajv";
import type { SnapshotConfig, WorkspaceMarker, WorkspaceRecord } from "../../core/domain/workspace";
import { SnapshotError } from "../../core/errors";
import { snapshotConfigSchema, workspaceMarkerSchema, workspaceRecordSchema } from "./schemas";

const ajv = new Ajv({ allErrors: true, strict: false });

const validateConfig = ajv.compile<SnapshotConfig>(snapshotConfigSchema as object);
const validateWorkspace = ajv.compile<WorkspaceRecord>(workspaceRecordSchema as object);
const validateMarker = ajv.compile<WorkspaceMarker>(workspaceMarkerSchema as object);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "unknown validation error";
  }
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`.trim())
    .join("; ");
}

export function assertValidConfig(data: unknown): asserts data is SnapshotConfig {
  if (!validateConfig(data)) {
    throw new SnapshotError("ERR_INVALID_CONFIG", formatErrors(validateConfig.errors));
  }
}

export function assertValidWorkspaceRecord(data: unknown): asserts data is WorkspaceRecord {
  if (!validateWorkspace(data)) {
    throw new SnapshotError("ERR_INVALID_WORKSPACE_RECORD", formatErrors(validateWorkspace.errors));
  }
}

export function assertValidWorkspaceMarker(data: unknown): asserts data is WorkspaceMarker {
  if (!validateMarker(data)) {
    throw new SnapshotError("ERR_INVALID_WORKSPACE_MARKER", formatErrors(validateMarker.errors));
  }
}
