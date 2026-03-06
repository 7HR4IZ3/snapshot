# Snapshot

Snapshot is a CLI for running multiple AI workspaces against one codebase with controlled review and merge workflows.

It is designed for this problem: you want parallel agent output, but you still want deterministic merges, explicit conflict reports, and reversible operations.

## What Snapshot Gives You

- Isolated workspaces per agent.
- Multiple workspace backends (`worktree`, `apfs-cow`, `overlay`, `auto`).
- Merge orchestration (`merge`, `merge-many`, `preflight`, reports).
- Review artifacts (interactive TUI and non-interactive approval mode).
- Recovery commands (`doctor`, `repair-mounts`, `unlock`, `revert`).
- Configurable workspace policies (`include`, `exclude`, `symlink`) with hard safety excludes.

## Installation and Setup

From this repository:

```bash
bun install
bun run build
bun link
```

Verify global command:

```bash
snapshot --help
```

If you prefer local source execution during development:

```bash
bun run src/cli.ts --help
```

## Concepts

- Project: the canonical git repository.
- Workspace: a spawned isolated working area associated with an agent.
- Workspace backend: how workspace files are materialized.
- Merge session: recorded result of `merge` or `merge-many`.
- Review artifact: persisted decision record from `review`.

## Backend Guide

Snapshot supports these backend modes for `spawn`:

- `worktree`
  - Uses git worktrees.
  - Very stable baseline behavior.
  - Can use more disk than CoW approaches for large trees.

- `apfs-cow`
  - Uses APFS copy-on-write clone behavior (macOS-focused).
  - Better disk efficiency for large repos when files are mostly unchanged.
  - Supports symlink policy controls.

- `overlay`
  - Uses overlay-style mounting logic where available.
  - Host capability dependent.
  - Can fail in strict mode if host/mount setup is not compatible.

- `auto`
  - Chooses best available backend from host capabilities and config.

Inspect backend support on current host:

```bash
snapshot backends /path/to/project
```

Strict backend request (no fallback):

```bash
snapshot spawn /path/to/project /path/to/ws --backend overlay --strict-backend
```

## 5-Minute Quickstart

Assume your repo is `/path/to/project`.

1) Initialize Snapshot metadata:

```bash
snapshot init /path/to/project
```

2) Spawn a workspace:

```bash
snapshot spawn /path/to/project /path/to/project-agent-a --backend auto
```

3) Edit files in `/path/to/project-agent-a`.

4) Inspect:

```bash
snapshot status /path/to/project-agent-a
snapshot diff /path/to/project-agent-a --stat
```

5) Merge:

```bash
snapshot merge /path/to/project-agent-a /path/to/project
```

## Workspace Policy: Include, Exclude, Symlink

Snapshot can filter workspace content and (for `apfs-cow`) symlink selected paths.

Config keys:

- `workspace.include`
- `workspace.exclude`
- `workspace.symlink`
- `workspace.symlinkMode` (`shared-live` or `safety-restricted`)

All three lists support glob patterns.

Examples:

```bash
snapshot config set workspace.include "src/**,packages/*/src/**" /path/to/project
snapshot config set workspace.exclude "**/private/**,**/*.secret" /path/to/project
snapshot config set workspace.symlink "generated/**" /path/to/project
snapshot config set workspace.symlinkMode "safety-restricted" /path/to/project
```

Per-spawn overrides:

```bash
snapshot spawn /path/to/project /path/to/ws \
  --backend apfs-cow \
  --include "src/**,generated/**" \
  --exclude "**/private/**" \
  --symlink "generated/**" \
  --symlink-mode shared-live
```

Important behavior:

- `shared-live`: symlinked paths are live links to project files. Editing them mutates canonical project content immediately.
- `safety-restricted`: symlinks to tracked paths are blocked; ignored/generated paths are allowed.

Always-on hard excludes (cannot be overridden):

- `.snapshot`
- `.spawned`
- `.worktrees`
- `worktrees`
- spawned workspace internals and discovered spawned workspace dirs

## Command Reference

This section explains what each command is for, its key parameters, and common usage.

### `snapshot init [project-path] [--force]`

Purpose:

- Initialize `.snapshot/` metadata in a git repo.
- Safe to run repeatedly (idempotent).

Parameters:

- `project-path` optional. If omitted, current directory is used.
- `--force` rewrites defaults.

Notes:

- Fails if you run it from inside a spawned workspace path.

### `snapshot spawn [project-path] <workspace-path> [flags]`

Purpose:

- Create a new agent workspace and metadata record.

Parameters:

- `project-path` optional (resolved from context if omitted).
- `workspace-path` required destination path.

Key flags:

- `--backend auto|worktree|apfs-cow|overlay`
- `--strict-backend`
- `--agent <id>`
- `--label <name>`
- `--from <branch-or-sha>`
- `--include <csv-globs>`
- `--exclude <csv-globs>`
- `--symlink <csv-globs>`
- `--symlink-mode shared-live|safety-restricted`

Behavior notes:

- Parent directories for `workspace-path` are created recursively.
- Policy flags override config for that spawn only.

### `snapshot list [project-path]`

Purpose:

- List known workspaces with backend, status, changed file count, and path.

### `snapshot status <workspace-ref>`

Purpose:

- Show workspace metadata, backend, review status, and file-change summary.

`workspace-ref` can be workspace path or workspace id.

### `snapshot diff <workspace-ref> [flags]`

Purpose:

- Show workspace changes relative to base commit.

Flags:

- `--name-only`
- `--patch`
- `--stat`
- `--base <sha>`

### `snapshot review <workspace-ref> [flags]`

Purpose:

- Create review artifacts for workspace changes.

Modes:

- interactive TUI (default in TTY)
- `--readonly` (no artifact write)
- `--approve-all` (non-interactive approved artifact)

Flags:

- `--reviewer <id>`
- `--export <path>`

### `snapshot merge <workspace-ref> [project-path] [flags]`

Purpose:

- Merge one workspace into target branch.

Flags:

- `--target <branch>`
- `--prefer none|virtual|target`
- `--commit`
- `--no-commit`
- `--message <text>`

Behavior notes:

- Auto-checkpoints uncommitted workspace changes before merge.
- Uses config `merge.autoCommit` if commit flags are omitted.
- If merge fails with conflicts (human mode, non-JSON, TTY), Snapshot opens conflict UI automatically.
- Conflict UI shows target vs workspace content side-by-side at the top, and a conflict-free merged preview below.
- Resolve actions in UI:
  - `1` keep target
  - `2` keep workspace
  - `3` manual
  - `f` finalize staged choices

### `snapshot merge-many [project-path] --from <refs> [flags]`

Purpose:

- Merge multiple workspaces in a deterministic queue.

Required:

- `--from <ws1,ws2,...>`

Flags:

- `--order created|priority|manual`
- `--preflight`
- `--continue-on-conflict`
- `--stop-on-conflict`
- `--report <path>`
- `--commit` / `--no-commit`

Behavior notes:

- stop-on-conflict records remaining entries as `skipped`.
- preflight mode is non-mutating.

### `snapshot revert [project-path] [flags]`

Purpose:

- Revert merge-session commits.

Flags:

- `--session <merge-session-id>`
- `--last`
- `--abort`

### `snapshot cleanup ...`

Purpose:

- Remove workspaces and archive/purge metadata.

Forms:

- `snapshot cleanup <workspace-ref> [--delete-branch] [--force]`
- `snapshot cleanup [project-path] --all-archived`

### `snapshot unlock [project-path] --force`

Purpose:

- Force remove merge lock file.

### `snapshot backends [project-path]`

Purpose:

- Show backend availability/capability diagnostics.

### `snapshot repair-mounts [project-path]`

Purpose:

- Repair stale overlay metadata state.

### `snapshot doctor [project-path] [--repair]`

Purpose:

- Combined health report for repo/snapshot/lock/backend status.

Flag:

- `--repair` also runs overlay repair.

### `snapshot config ...`

Purpose:

- Get and set project config values.

Forms:

- `snapshot config get [project-path]`
- `snapshot config set <key> <value> [project-path]`

Common keys:

- `workspace.backendDefault`
- `workspace.fallbackPolicy`
- `workspace.include`
- `workspace.exclude`
- `workspace.symlink`
- `workspace.symlinkMode`
- `merge.prefer`
- `merge.autoCommit`
- `merge.stopOnConflict`
- `review.requireApprovalBeforeMerge`

## Examples by Scenario

### Scenario: Merge generated files as live symlinks only

```bash
snapshot config set workspace.symlink "generated/**" /path/to/project
snapshot config set workspace.symlinkMode "safety-restricted" /path/to/project
snapshot spawn /path/to/project /path/to/ws --backend apfs-cow
```

### Scenario: Manual commit control in merge pipeline

```bash
snapshot config set merge.autoCommit false /path/to/project
snapshot merge /path/to/ws /path/to/project
git -C /path/to/project status
git -C /path/to/project commit -m "manual merge commit"
```

### Scenario: Diagnose and recover

```bash
snapshot doctor /path/to/project
snapshot doctor /path/to/project --repair
snapshot unlock /path/to/project --force
```

## Build and Distribution

Build emitted JS CLI:

```bash
bun run build
```

Output:

- `dist/cli.js`

`package.json` maps:

- `bin.snapshot` -> `dist/cli.js`

## For Contributors

Run tests:

```bash
bun run test
```

Typecheck:

```bash
bunx tsc --noEmit
```

Specs live in `spec/`.

## Troubleshooting

- `ERR_BACKEND_UNAVAILABLE`
  - Requested backend is unavailable under current host/policy.
  - Use `snapshot backends` and adjust backend/fallback settings.

- `ERR_LOCK_HELD`
  - Merge lock is present.
  - If stale and safe to remove, run `snapshot unlock ... --force`.

- `ERR_REVIEW_TTY_REQUIRED`
  - Interactive review requires TTY.
  - Use `--readonly` or `--approve-all` in automation.

- merge applies but no merge commit created
  - Check `merge.autoCommit`, and command flags `--commit`/`--no-commit`.
