# 06 - Data Model

All metadata lives in project-local `.snapshot/`.

## Directory Layout

```txt
.snapshot/
  config.json
  workspaces/
    <workspace-id>.json
  reviews/
    <review-id>.json
  merges/
    <merge-session-id>.json
    <merge-session-id>.<workspace-id>.conflicts.json
  overlay/
    <workspace-id>/
      state.json
      upper/
      work/
  locks/
    merge.lock
```

## `config.json`

```json
{
  "version": 1,
  "projectPath": "/abs/path/to/repo",
  "workspace": {
    "backendDefault": "auto",
    "fallbackPolicy": "best-available",
    "include": [],
    "exclude": [],
    "symlink": [],
    "symlinkMode": "shared-live"
  },
  "merge": {
    "prefer": "virtual",
    "autoCommit": true,
    "stopOnConflict": true,
    "allowBinaryAutoResolve": false,
    "defaultOrder": "created"
  },
  "review": {
    "requireApprovalBeforeMerge": false
  }
}
```

## Workspace Record

```json
{
  "version": 1,
  "workspaceId": "ws_20260228_001",
  "label": "agent-parser-refactor",
  "agentId": "agent-3",
  "projectPath": "/abs/path/to/repo",
  "workspacePath": "/abs/path/to/workspace",
  "workspaceBranch": "snapshot/ws_20260228_001",
  "backend": "apfs-cow",
  "baseCommit": "abc123...",
  "targetBranchAtSpawn": "main",
  "createdAt": "2026-02-28T10:00:00.000Z",
  "status": "active",
  "priority": 0,
  "lastReviewId": null,
  "lastMergeSessionId": null
}
```

`status` enum:

- `active`
- `merged`
- `conflicted`
- `archived`

`backend` enum:

- `worktree`
- `apfs-cow`
- `overlay`

## Review Record

```json
{
  "version": 1,
  "reviewId": "rv_20260228_001",
  "workspaceId": "ws_20260228_001",
  "reviewerId": "human-1",
  "startedAt": "2026-02-28T10:05:00.000Z",
  "finishedAt": "2026-02-28T10:12:00.000Z",
  "overallDecision": "approved",
  "files": [
    {
      "path": "src/merge.ts",
      "status": "M",
      "decision": "approved",
      "notes": [
        {
          "message": "Consider extracting helper later"
        }
      ]
    }
  ]
}
```

## Merge Session Record

```json
{
  "version": 1,
  "mergeSessionId": "mg_20260228_001",
  "mode": "many",
  "projectPath": "/abs/path/to/repo",
  "targetBranch": "main",
  "targetStartSha": "def456...",
  "targetEndSha": "fed999...",
  "prefer": "virtual",
  "startedAt": "2026-02-28T10:20:00.000Z",
  "finishedAt": "2026-02-28T10:21:00.000Z",
  "entries": [
    {
      "workspaceId": "ws_20260228_001",
      "workspaceBranch": "snapshot/ws_20260228_001",
      "result": "merged",
      "mergeCommitSha": "fed999...",
      "autoResolvedTextConflicts": 0,
      "unresolvedConflicts": [],
      "artifactPath": null,
      "message": "workspace auto-committed abcdef123456"
    },
    {
      "workspaceId": "ws_20260228_002",
      "workspaceBranch": "snapshot/ws_20260228_002",
      "result": "conflict",
      "mergeCommitSha": null,
      "autoResolvedTextConflicts": 0,
      "unresolvedConflicts": [
        {
          "path": "src/app.ts",
          "class": "text_conflict",
          "code": "UU",
          "guidance": "Open file and resolve markers"
        }
      ],
      "artifactPath": ".snapshot/merges/mg_...ws_....conflicts.json",
      "message": "unresolved conflicts"
    }
  ]
}
```

## Conflict Artifact Record

```json
{
  "version": 1,
  "mergeSessionId": "mg_20260228_001",
  "workspaceId": "ws_20260228_002",
  "workspaceBranch": "snapshot/ws_20260228_002",
  "generatedAt": "2026-02-28T10:20:31.000Z",
  "unresolvedConflicts": [
    {
      "path": "src/app.ts",
      "class": "text_conflict",
      "code": "UU",
      "guidance": "Open file and resolve markers"
    }
  ],
  "git": {
    "stdout": "...",
    "stderr": "..."
  }
}
```

## Validation Rules

1. `projectPath` and `workspacePath` must be absolute paths.
2. IDs (`workspaceId`, `reviewId`, `mergeSessionId`) are immutable.
3. Metadata writes must be atomic.
4. Backward-compat defaults are injected for older config/workspace records.
5. Hard internal paths are excluded from spawned workspace content independent of user filters.
