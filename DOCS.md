# Snapshot docs

Snapshot is a git-only CLI for isolated AI workspaces and controlled merges.

## Project resolution

Project-scoped commands infer the project from the current directory. If the current directory is inside a spawned workspace, Snapshot follows its workspace marker back to the canonical project.

To target a different project:

```bash
snapshot list --project /path/to/project
snapshot doctor --project /path/to/project
```

Legacy positional project paths are still accepted for compatibility, but `--project` is the preferred form.

## Core workflow

```bash
cd /path/to/project
snapshot init
snapshot spawn ../agent-a --agent agent-a --label agent-a
snapshot list
snapshot status ../agent-a
snapshot review ../agent-a
snapshot merge ../agent-a
```

`workspace-path` may be absolute or relative to the directory where the command runs. Snapshot records the workspace branch, base commit, backend, policy, and lifecycle state.

## Command reference

### Init

```bash
snapshot init [--project <path>] [--force]
```

Initializes `.snapshot/` metadata and adds it to Git’s excludes. It is idempotent. Initialization from a spawned workspace is rejected.

### Spawn a workspace

```bash
snapshot spawn <workspace-path> [--project <path>] [options]
```

Options:

- `--agent <id>`
- `--label <name>`
- `--from <branch-or-sha>`
- `--backend auto|worktree|apfs-cow|overlay`
- `--strict-backend`
- `--include <csv-globs>`
- `--exclude <csv-globs>`
- `--symlink <csv-globs>`
- `--symlink-mode shared-live|safety-restricted`

Parent directories are created automatically. Include, exclude, and symlink flags override project config for that workspace only.

### Single-file snapshots

```bash
snapshot spawn-file <source-file> <snapshot-file> [--project <path>] [--agent <id>] [--label <name>]
snapshot pull-file <snapshot-ref> [--project <path>] [--force]
snapshot pull-all [--project <path>] [--force]
```

Snapshot stores a base copy and attempts a three-way merge when both the project file and copied file changed. `--force` overwrites the project file with the snapshot content.

### Inspect workspaces

```bash
snapshot list [--project <path>]
snapshot status <workspace-ref>
snapshot diff <workspace-ref> [--name-only|--patch|--stat] [--base <sha>]
```

`workspace-ref` can be a workspace path or workspace ID.

### Dashboard

```bash
snapshot tui [--project <path>]
```

The OpenTUI dashboard requires an interactive terminal and shows:

- Overview and recent merge activity.
- Workspace inventory and changed-file counts.
- Merge sessions and conflict entries.
- Host backend capabilities and project health.

Keys:

- `1`–`4`: Overview, Workspaces, Merges, Health.
- `h`/`l` or `←`/`→`: switch tabs.
- `j`/`k` or `↑`/`↓`: move through lists.
- `r`: refresh.
- `?`: help.
- `q`: quit.

### Review

```bash
snapshot review <workspace-ref> [--reviewer <id>] [--export <path>]
snapshot review <workspace-ref> --readonly
snapshot review <workspace-ref> --approve-all
```

TTY mode opens the OpenTUI review screen. It supports file/hunk navigation, approve/reject decisions, notes, filters, and save/cancel. `--readonly` and `--approve-all` are intended for automation.

### Merge

```bash
snapshot merge <workspace-ref> [--project <path>] [options]
snapshot merge-many [--project <path>] --from <ref1,ref2,...> [options]
```

Options:

- `--target <branch>`
- `--prefer none|virtual|target`
- `--order created|priority|manual`
- `--preflight`
- `--continue-on-conflict`
- `--stop-on-conflict`
- `--commit` / `--no-commit`
- `--message <text>`
- `--report <path>`

Uncommitted workspace changes are auto-checkpointed before merging. If commit flags are omitted, config `merge.autoCommit` controls commit behavior.

`merge-many` processes workspaces deterministically. Preflight is non-mutating. Multi-workspace merges require commits so each entry can be tracked and reverted safely.

### Conflicts

Interactive merge conflicts open an OpenTUI resolver when stdin and stdout are TTYs.

Single-workspace conflict keys:

- `1`: keep target.
- `2`: keep workspace.
- `m`: manually edit the selected chunk.
- `n`/`p`: next/previous chunk.
- `j`/`k`: next/previous file.
- `f`: finalize once every chunk is resolved.
- `q`: leave the conflict untouched.

Multi-workspace conflict keys:

- `1`–`9`: accept a version.
- `a`: accept the recommended version.
- `m`: manually edit.
- `f`: finalize after all chunks are resolved.

Non-TTY commands return unresolved conflicts for external handling.

### Recovery and diagnostics

```bash
snapshot doctor [--project <path>] [--repair]
snapshot backends [--project <path>]
snapshot repair-mounts [--project <path>]
snapshot unlock [--project <path>] --force
snapshot revert [--project <path>] --last
snapshot revert [--project <path>] --session <merge-session-id>
snapshot revert [--project <path>] --abort
```

- `doctor` checks Git, Snapshot initialization, locks, dirty state, and backend health.
- `backends` reports host and project backend availability.
- `repair-mounts` repairs stale overlay metadata.
- `unlock --force` removes a stale merge lock.
- `revert` reverses a recorded merge session.

### Cleanup

```bash
snapshot cleanup <workspace-ref> [--delete-branch] [--force]
snapshot cleanup --all-archived [--project <path>]
```

The first form archives a workspace and optionally removes its branch. The second purges archived metadata.

### Config

```bash
snapshot config get [--project <path>]
snapshot config set <key> <value> [--project <path>]
```

Common keys:

- `workspace.backendDefault`: `auto`, `worktree`, `apfs-cow`, or `overlay`.
- `workspace.fallbackPolicy`: `best-available` or `error`.
- `workspace.include`
- `workspace.exclude`
- `workspace.symlink`
- `workspace.symlinkMode`: `shared-live` or `safety-restricted`.
- `merge.prefer`: `none`, `virtual`, or `target`.
- `merge.autoCommit`
- `merge.stopOnConflict`
- `merge.allowBinaryAutoResolve`
- `merge.defaultOrder`: `created`, `priority`, or `manual`.
- `review.requireApprovalBeforeMerge`

Example:

```bash
snapshot config set workspace.include "src/**,packages/*/src/**"
snapshot config set merge.autoCommit false
```

## Backends and policies

### Backends

- `worktree`: standard Git worktree; the safest general default.
- `apfs-cow`: macOS APFS copy-on-write clone; disk efficient.
- `overlay`: Linux overlay-style mount; host and privilege dependent.
- `auto`: selects the best available backend.

Use `--strict-backend` when fallback is not acceptable.

### Include, exclude, and symlink policy

Patterns use globs. Policies can be set in config or overridden during `spawn`.

`shared-live` symlinks point at canonical project files, so edits can mutate the project immediately. `safety-restricted` blocks symlinks to tracked paths and allows ignored/generated paths only.

Always-excluded paths cannot be overridden:

- `.snapshot`
- `.spawned`
- `.worktrees`
- `worktrees`
- workspace internals and discovered spawned workspace directories

## JSON and automation

Add `--json` before or after the command for machine-readable responses:

```bash
snapshot --json list
snapshot status ../agent-a --json
snapshot doctor --project /path/to/project --json
```

Interactive TUIs require a TTY. Use `--readonly`, `--approve-all`, JSON commands, or external conflict tooling in automation.

## Troubleshooting

- `ERR_BACKEND_UNAVAILABLE`: inspect capabilities with `snapshot backends` or choose another backend.
- `ERR_LOCK_HELD`: inspect the merge state; remove only a confirmed stale lock with `snapshot unlock --force`.
- `ERR_REVIEW_TTY_REQUIRED`: use `--readonly` or `--approve-all` outside a TTY.
- A merge applies changes but creates no commit: check `merge.autoCommit`, `--commit`, and `--no-commit`. A manual no-commit merge must be committed before Snapshot can revert it.

## Build and contribute

```bash
bun install
bun run test
bunx tsc --noEmit
bun run build
```

Build output is `dist/cli.js`. Specs live in `spec/`.
