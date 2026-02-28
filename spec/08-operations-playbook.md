# 08 - Operations Playbook

This playbook contains practical command recipes for common operational flows.

## 1) Strict Backend Spawn

Use strict mode when backend fallback is not acceptable.

```bash
snapshot spawn /path/to/project /path/to/workspace \
  --backend overlay \
  --strict-backend
```

Expected behavior:

- If requested backend is available: spawn succeeds.
- If unavailable: spawn fails with `ERR_BACKEND_UNAVAILABLE`.

## 2) Safe Symlink Policy

Recommended for shared paths where direct live mutation risk must be controlled.

```bash
snapshot config set workspace.symlink "generated/**,cache/**" /path/to/project
snapshot config set workspace.symlinkMode "safety-restricted" /path/to/project
```

Spawn with `apfs-cow`:

```bash
snapshot spawn /path/to/project /path/to/workspace --backend apfs-cow
```

Expected behavior:

- Symlink patterns are applied only for `apfs-cow` backend.
- In `safety-restricted` mode, symlinking tracked paths fails (`ERR_SYMLINK_RESTRICTED`).
- Ignored/generated paths are allowed.

## 3) Shared-Live Symlink Mode

Use when direct shared path mutation is intentional and understood.

```bash
snapshot config set workspace.symlink "generated/**" /path/to/project
snapshot config set workspace.symlinkMode "shared-live" /path/to/project
snapshot spawn /path/to/project /path/to/workspace --backend apfs-cow
```

Important:

- Editing symlinked paths updates canonical project content immediately.
- This bypasses normal isolation for those paths.

## 4) Include/Exclude Filters with Globs

```bash
snapshot config set workspace.include "src/**,packages/*/src/**" /path/to/project
snapshot config set workspace.exclude "**/*.secret,**/private/**" /path/to/project
snapshot spawn /path/to/project /path/to/workspace --backend auto
```

Notes:

- `include`, `exclude`, and `symlink` all support glob patterns.
- Hard internal exclusions are always enforced regardless of config:
  - `.snapshot/**`
  - `.spawned/**`
  - `.worktrees/**`
  - `worktrees/**`
  - discovered spawned workspace directories

## 5) No Auto-Commit Merge Workflow

Set project default:

```bash
snapshot config set merge.autoCommit false /path/to/project
```

Merge without explicit flags:

```bash
snapshot merge <workspace-ref> /path/to/project
```

Expected behavior:

- Merge applies changes without creating a merge commit.
- You can inspect and commit manually.

Override per command:

```bash
snapshot merge <workspace-ref> /path/to/project --commit
snapshot merge <workspace-ref> /path/to/project --no-commit
```

## 6) Doctor + Repair Flow

Quick health check:

```bash
snapshot doctor /path/to/project
```

Health check with overlay metadata repair:

```bash
snapshot doctor /path/to/project --repair
```

Standalone repair command:

```bash
snapshot repair-mounts /path/to/project
```

## 7) Lock Recovery

When merge lock is stale and blocking operations:

```bash
snapshot unlock /path/to/project --force
```

## 8) Merge Queue Operations

Preflight only (no mutation):

```bash
snapshot merge-many /path/to/project --from ws-a,ws-b,ws-c --preflight
```

Stop on first conflict and export report:

```bash
snapshot merge-many /path/to/project --from ws-a,ws-b,ws-c \
  --stop-on-conflict \
  --report merge-report.json
```

Continue across conflicts and export report:

```bash
snapshot merge-many /path/to/project --from ws-a,ws-b,ws-c \
  --continue-on-conflict \
  --report merge-report.json
```

## 9) Revert Last Merge Session

```bash
snapshot revert /path/to/project --last
```

Revert specific merge session:

```bash
snapshot revert /path/to/project --session mg_20260228_001
```

Abort in-progress revert:

```bash
snapshot revert /path/to/project --abort
```

## 10) Build + Install CLI Globally

Build JS output and make executable:

```bash
bun run build
```

Link package globally:

```bash
bun link
```

Verify:

```bash
snapshot --help
```
