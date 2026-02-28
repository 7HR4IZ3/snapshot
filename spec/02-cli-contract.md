# 02 - CLI Contract

## Command Style

- Binary: `snapshot`
- Global flags:
  - `--json`: print machine-readable output where supported
  - `--verbose`: include debug diagnostics
  - `--no-color`: disable ANSI color

## Exit Codes

- `0`: success
- `1`: generic failure
- `2`: invalid usage or validation error
- `3`: merge conflict detected
- `4`: repository state unsafe (dirty target, lock held, detached HEAD, etc.)

## `snapshot init <project-path>`

Initializes snapshot metadata in a git repository.

### Behavior

1. Validate `<project-path>` exists and is a git repository.
2. Create `.snapshot/` structure if missing.
3. Write default config if absent.
4. Do not overwrite existing config unless `--force` provided.

### Flags

- `--force`: overwrite default config values

## `snapshot spawn <project-path> <workspace-path>`

Creates a new workspace branch + worktree and records metadata.

### Behavior

1. Validate project is initialized.
2. Resolve base branch and base commit (default: current HEAD branch/commit).
3. Allocate unique workspace id.
4. Create branch name: `snapshot/<workspace-id>`.
5. Create git worktree at `<workspace-path>`.
6. Write workspace metadata record.

### Flags

- `--agent <agent-id>`: logical owner id
- `--from <branch-or-sha>`: explicit spawn base
- `--label <name>`: human-readable workspace label

## `snapshot status <workspace-path|workspace-id>`

Shows workspace status and divergence information.

### Output

- workspace id, agent id, label
- branch, base commit, current HEAD
- changed files count and summary by status (A/M/D/R)
- review status (not-reviewed, in-review, approved, rejected)

## `snapshot diff <workspace-path|workspace-id>`

Prints changes relative to workspace base.

### Flags

- `--name-only`: file list only
- `--patch`: full patch (default in human mode)
- `--stat`: compact diff stat
- `--base <sha>`: override default base for ad-hoc inspection

## `snapshot review <workspace-path|workspace-id>`

Starts interactive review TUI for the workspace.

### Behavior

1. Build file list from diff against base.
2. Let reviewer navigate files and hunks.
3. Capture approve/reject/note decisions.
4. Persist review artifact under `.snapshot/reviews/`.

### Flags

- `--reviewer <id>`: reviewer identity
- `--export <path>`: write markdown summary file
- `--readonly`: no state changes, browse only

## `snapshot merge <workspace-ref> <project-path>`

Merges one workspace into target branch.

### Behavior

1. Acquire project merge lock.
2. Validate target branch is clean and checked out.
3. Execute merge strategy (default virtual preferred for text conflicts).
4. Emit conflict report and exit code `3` on unresolved conflicts.
5. Record merge session metadata.

### Flags

- `--target <branch>`: merge destination (default current branch)
- `--prefer <virtual|target>`: conflict preference for text hunks
- `--commit/--no-commit`: finalize commit automatically (default commit)
- `--message <text>`: merge commit message override

## `snapshot merge-many <project-path> --from <refs>`

Queues multiple workspace merges in deterministic order.

### Behavior

1. Parse refs as comma-separated workspace ids/paths.
2. Sort by configured ordering strategy.
3. Merge each workspace sequentially into evolving target.
4. On conflict: stop by default; write partial report.

### Flags

- `--order <created|priority|manual>`
- `--continue-on-conflict`: continue processing remaining workspaces
- `--prefer <virtual|target>`
- `--report <path>`: export JSON merge report

## `snapshot cleanup <workspace-ref>`

Removes workspace worktree and optionally branch metadata.

### Flags

- `--delete-branch`: delete workspace branch
- `--force`: cleanup even when unmerged changes exist

## JSON Output Contract

When `--json` is enabled, all command responses must include:

- `ok`: boolean
- `command`: command name
- `timestamp`: ISO timestamp
- `data`: command-specific object
- `errors`: array of structured error objects
