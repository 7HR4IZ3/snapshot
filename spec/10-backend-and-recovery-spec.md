# 10 - Backend and Recovery Spec

## Supported Backends

- `worktree`
- `apfs-cow`
- `overlay`
- `auto` (selection policy)

## Backend Selection

Selection inputs:

- command: `--backend`, `--strict-backend`
- config:
  - `workspace.backendDefault`
  - `workspace.fallbackPolicy`

Resolution:

1. explicit command backend wins over config
2. if backend unavailable:
   - strict mode or fallback policy `error`: fail with `ERR_BACKEND_UNAVAILABLE`
   - fallback policy `best-available`: degrade according to host capabilities

## Backend Capability Checks

- `apfs-cow`:
  - available on macOS when `cp -cR` probe succeeds
- `overlay`:
  - currently probed as Linux + `mount` command availability
- `worktree`:
  - baseline backend (git worktree support expected)

## Backend Diagnostics Command

`snapshot backends [project-path]`

Outputs:

- host platform
- backend availability + reason
- project initialization status
- configured default backend
- workspace count by backend

## Recovery Commands

### `snapshot doctor [project-path] [--repair]`

Combined health report for:

- git repository state
- snapshot initialization state
- merge lock presence
- dirty working tree status
- backend capability matrix

If `--repair` is used, overlay state repair is executed and included in output.

### `snapshot repair-mounts [project-path]`

Repairs stale overlay state metadata records:

- scans `.snapshot/overlay/*/state.json`
- marks records unmounted when workspace paths are missing

### `snapshot unlock [project-path] --force`

Force-removes merge lock file.

## Revert Recovery

`snapshot revert` supports:

- `--session <merge-session-id>`
- `--last`
- `--abort`

Revert conflicts return exit code `3` and `ERR_REVERT_CONFLICT`.
