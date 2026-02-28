export const snapshotConfigSchema = {
  type: "object",
  properties: {
    version: { type: "integer", const: 1 },
    projectPath: { type: "string", minLength: 1 },
    workspace: {
      type: "object",
      properties: {
        backendDefault: { type: "string", enum: ["auto", "worktree", "apfs-cow", "overlay"] },
        fallbackPolicy: { type: "string", enum: ["best-available", "error"] },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
        symlink: { type: "array", items: { type: "string" } },
        symlinkMode: { type: "string", enum: ["shared-live", "safety-restricted"] },
      },
      required: ["backendDefault", "fallbackPolicy", "include", "exclude", "symlink", "symlinkMode"],
      additionalProperties: false,
    },
    merge: {
      type: "object",
      properties: {
        prefer: { type: "string", enum: ["virtual", "target"] },
        autoCommit: { type: "boolean" },
        stopOnConflict: { type: "boolean" },
        allowBinaryAutoResolve: { type: "boolean" },
        defaultOrder: { type: "string", enum: ["created", "priority", "manual"] },
      },
      required: ["prefer", "autoCommit", "stopOnConflict", "allowBinaryAutoResolve", "defaultOrder"],
      additionalProperties: false,
    },
    review: {
      type: "object",
      properties: {
        requireApprovalBeforeMerge: { type: "boolean" },
      },
      required: ["requireApprovalBeforeMerge"],
      additionalProperties: false,
    },
  },
  required: ["version", "projectPath", "workspace", "merge", "review"],
  additionalProperties: false,
} as const;

export const workspaceRecordSchema = {
  type: "object",
  properties: {
    version: { type: "integer", const: 1 },
    workspaceId: { type: "string", minLength: 1 },
    label: { anyOf: [{ type: "string" }, { type: "null" }] },
    agentId: { anyOf: [{ type: "string" }, { type: "null" }] },
    projectPath: { type: "string", minLength: 1 },
    workspacePath: { type: "string", minLength: 1 },
    workspaceBranch: { type: "string", minLength: 1 },
    backend: { type: "string", enum: ["worktree", "apfs-cow", "overlay"] },
    baseCommit: { type: "string", minLength: 1 },
    targetBranchAtSpawn: { type: "string", minLength: 1 },
    createdAt: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["active", "merged", "conflicted", "archived"] },
    priority: { type: "number" },
    lastReviewId: { anyOf: [{ type: "string" }, { type: "null" }] },
    lastMergeSessionId: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "version",
    "workspaceId",
    "label",
    "agentId",
    "projectPath",
    "workspacePath",
    "workspaceBranch",
    "backend",
    "baseCommit",
    "targetBranchAtSpawn",
    "createdAt",
    "status",
    "priority",
    "lastReviewId",
    "lastMergeSessionId",
  ],
  additionalProperties: false,
} as const;

export const workspaceMarkerSchema = {
  type: "object",
  properties: {
    version: { type: "integer", const: 1 },
    workspaceId: { type: "string", minLength: 1 },
    projectPath: { type: "string", minLength: 1 },
  },
  required: ["version", "workspaceId", "projectPath"],
  additionalProperties: false,
} as const;
