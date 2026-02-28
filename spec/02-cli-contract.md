# 02 - CLI Contract

## Command Style

- Binary: `snapshot`
- Global flags:
  - `--json`: machine-readable output where supported
  - `--verbose`: include debug diagnostics

## Exit Codes

- `0`: success
- `1`: generic failure
- `2`: invalid usage / validation failure
- `3`: merge or revert conflict (`ERR_MERGE_CONFLICT`, `ERR_REVERT_CONFLICT`)
- `4`: unsafe repository state (`ERR_TARGET_DIRTY`, `ERR_LOCK_HELD`)

## Path Resolution Rules

For commands with optional `[project-path]`:

1. If path is provided, use it.
2. Else if current directory is a spawned workspace, resolve project via `.snapshot-workspace.json`.
3. Else try to resolve project by discovering `.snapshot/` upward from cwd.
4. Else fallback to cwd where command semantics allow (for initialization and diagnostics).

## `snapshot init [project-path]`

Initialize snapshot metadata in a git repository.

### Behavior

1. Validate target path is a git repository.
2. Create `.snapshot/` layout if missing.
3. Write default config if absent (or overwrite with `--force`).
4. If already initialized and not forced, return success with `created=false`.
5. If called from a spawned workspace directory, fail (`ERR_USAGE`).

### Flags

- `--force`

## `snapshot spawn [project-path] <workspace-path>`

Create new workspace and metadata record.

### Behavior

1. Validate project is initialized.
2. Resolve `baseCommit` from `--from` (default `HEAD`).
3. Choose backend (`--backend` or config default):
   - `worktree`
   - `apfs-cow`
   - `overlay`
   - `auto`
4. Honor fallback policy (`--strict-backend` or config policy).
5. Ensure parent of workspace path exists (recursive mkdir).
6. Apply workspace content policy:
   - include globs
   - exclude globs
   - `apfs-cow` symlink globs
   - hard excludes always enforced
7. Persist workspace marker and workspace record.

### Flags

- `--agent <id>`
- `--label <name>`
- `--from <branch-or-sha>`
- `--backend <auto|worktree|apfs-cow|overlay>`
- `--strict-backend`
- `--include <csv-globs>`
- `--exclude <csv-globs>`
- `--symlink <csv-globs>` (applies only to `apfs-cow`)
- `--symlink-mode <shared-live|safety-restricted>`

## `snapshot status <workspace-path|workspace-id>`

Outputs workspace metadata, backend, review status, and diff summary from `baseCommit`.

## `snapshot diff <workspace-path|workspace-id>`

Shows changes relative to `baseCommit`.

### Flags

- `--name-only`
- `--patch` (default human mode)
- `--stat`
- `--base <sha>`

## `snapshot list [project-path]`

List known workspaces with backend, status, and changed file counts.

## `snapshot review <workspace-path|workspace-id>`

Interactive or non-interactive review workflow.

### Flags

- `--reviewer <id>`
- `--export <path>`
- `--readonly`
- `--approve-all` (non-interactive artifact creation)

## `snapshot merge <workspace-ref> [project-path]`

Merge one workspace into target branch.

### Behavior

1. Acquire merge lock.
2. Validate target is clean.
3. Auto-checkpoint uncommitted workspace changes before merge.
4. Merge with configured or explicit preference.
5. Respect merge commit mode (`--commit`, `--no-commit`, or config `merge.autoCommit`).
6. Persist merge session and update workspace status.

### Flags

- `--target <branch>`
- `--prefer <virtual|target>`
- `--commit`
- `--no-commit`
- `--message <text>`

## `snapshot merge-many [project-path] --from <refs>`

Queue merge workspaces in deterministic order.

### Flags

- `--order <created|priority|manual>`
- `--continue-on-conflict`
- `--stop-on-conflict`
- `--preflight`
- `--prefer <virtual|target>`
- `--commit`
- `--no-commit`
- `--message <text>`
- `--report <path>`

## `snapshot revert [project-path]`

Revert merge-session commits in reverse order.

### Flags

- `--session <merge-session-id>`
- `--last`
- `--abort`

## `snapshot cleanup`

### Forms

- `snapshot cleanup <workspace-ref> [--delete-branch] [--force]`
- `snapshot cleanup [project-path] --all-archived`

## `snapshot unlock [project-path] --force`

Force-remove merge lock file.

## `snapshot backends [project-path]`

Show backend capability matrix and project backend summary.

## `snapshot repair-mounts [project-path]`

Repair overlay state metadata for stale/missing mounted workspaces.

## `snapshot doctor [project-path] [--repair]`

Combined health check (repo state, snapshot state, lock state, backend capabilities), with optional overlay repair.

## `snapshot config`

### Forms

- `snapshot config get [project-path]`
- `snapshot config set <key> <value> [project-path]`

### Supported Keys

- `workspace.backendDefault`
- `workspace.fallbackPolicy`
- `workspace.include`
- `workspace.exclude`
- `workspace.symlink`
- `workspace.symlinkMode`
- `merge.autoCommit`
- `merge.stopOnConflict`
- `review.requireApprovalBeforeMerge`

## JSON Output Contract

All JSON responses include:

- `ok`
- `command`
- `timestamp`
- `data`
- `errors`
