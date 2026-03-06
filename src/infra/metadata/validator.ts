import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import type {
  FileSnapshotRecord,
} from "../../core/domain/file-snapshot.js";
import type {
  SnapshotConfig,
  WorkspaceMarker,
  WorkspaceRecord,
} from "../../core/domain/workspace.js";
import { SnapshotError } from "../../core/errors.js";
import {
  snapshotConfigSchema,
  fileSnapshotRecordSchema,
  workspaceMarkerSchema,
  workspaceRecordSchema,
} from "./schemas.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/ajv.js") as new (opts: {
  allErrors: boolean;
  strict: boolean;
}) => {
  compile: <T>(
    schema: object,
  ) => ((data: unknown) => data is T) & { errors?: ErrorObject[] | null };
};

const ajv = new Ajv({ allErrors: true, strict: false });

const validateConfig = ajv.compile<SnapshotConfig>(
  snapshotConfigSchema as object,
);
const validateWorkspace = ajv.compile<WorkspaceRecord>(
  workspaceRecordSchema as object,
);
const validateMarker = ajv.compile<WorkspaceMarker>(
  workspaceMarkerSchema as object,
);
const validateFileSnapshot = ajv.compile<FileSnapshotRecord>(
  fileSnapshotRecordSchema as object,
);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "unknown validation error";
  }
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`.trim())
    .join("; ");
}

export function assertValidConfig(
  data: unknown,
): asserts data is SnapshotConfig {
  if (!validateConfig(data)) {
    throw new SnapshotError(
      "ERR_INVALID_CONFIG",
      formatErrors(validateConfig.errors),
    );
  }
}

export function assertValidWorkspaceRecord(
  data: unknown,
): asserts data is WorkspaceRecord {
  if (!validateWorkspace(data)) {
    throw new SnapshotError(
      "ERR_INVALID_WORKSPACE_RECORD",
      formatErrors(validateWorkspace.errors),
    );
  }
}

export function assertValidWorkspaceMarker(
  data: unknown,
): asserts data is WorkspaceMarker {
  if (!validateMarker(data)) {
    throw new SnapshotError(
      "ERR_INVALID_WORKSPACE_MARKER",
      formatErrors(validateMarker.errors),
    );
  }
}

export function assertValidFileSnapshotRecord(
  data: unknown,
): asserts data is FileSnapshotRecord {
  if (!validateFileSnapshot(data)) {
    throw new SnapshotError(
      "ERR_INVALID_FILE_SNAPSHOT_RECORD",
      formatErrors(validateFileSnapshot.errors),
    );
  }
}
