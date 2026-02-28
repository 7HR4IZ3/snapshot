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
  locks/
    merge.lock
```

## `config.json`

```json
{
  "version": 1,
  "projectPath": "/abs/path/to/repo",
  "merge": {
    "prefer": "virtual",
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
          "line": 88,
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
  "mode": "single",
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
      "autoResolvedTextConflicts": 2,
      "unresolvedConflicts": []
    }
  ]
}
```

## Validation Rules

1. `projectPath` and `workspacePath` must be absolute paths.
2. `workspaceId`, `reviewId`, and `mergeSessionId` are immutable.
3. `version` must match supported schema version.
4. metadata writes must be atomic to avoid partial corruption.
5. unknown fields should be preserved where feasible for forward compatibility.

## Backward Compatibility Strategy

- Use integer `version` in each file.
- On startup, run lightweight migration if known older versions are found.
- If unsupported version is encountered, fail with actionable migration message.
