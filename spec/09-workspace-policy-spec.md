# 09 - Workspace Policy Spec

## Purpose

Define exact semantics for workspace content policy controls applied during `spawn`.

Policy controls exist in project config and can be overridden per spawn command:

- `workspace.include`
- `workspace.exclude`
- `workspace.symlink` (applies to `apfs-cow` backend only)
- `workspace.symlinkMode` (`shared-live` or `safety-restricted`)

## Policy Precedence

For each spawn operation:

1. Determine effective policy values.
   - Command flags override config.
   - Missing command values fall back to config.
2. Compute hard excludes (always on).
3. Apply include filter.
4. Apply exclude filter.
5. For `apfs-cow`, apply symlink policy.

## Glob Semantics

- `include`, `exclude`, and `symlink` accept comma-separated glob patterns.
- Matching is path-relative to project root.
- Dotfiles are matchable.

Examples:

- `src/**`
- `packages/*/src/**`
- `**/*.md`
- `**/private/**`

## Hard Excludes (Unconditional)

Hard excludes are applied regardless of config or command flags.

Minimum hard excluded roots and files:

- `.snapshot/**`
- `.spawned/**`
- `.worktrees/**`
- `worktrees/**`
- `.snapshot-workspace.json`

Dynamic hard excludes:

- all known workspace directories from metadata
- discovered workspace directories containing `.snapshot-workspace.json`
- current overlay internal state path for the workspace

## Include/Exclude Behavior

- If `include` is empty: include all files except excluded files.
- If `include` is set: only included matches survive to next step.
- `exclude` removes matches from the included set.
- Hard excludes remove matches regardless of include results.

## Symlink Behavior (`apfs-cow`)

`workspace.symlink` applies only when effective backend is `apfs-cow`.

- matched target paths in workspace are replaced with symlinks to canonical project paths
- directory symlinks are preferred for directory-level matches
- parent-linked directories suppress redundant child links

### Symlink Modes

1. `shared-live`
   - allows symlinking any matched path (except hard excludes)
   - edits to symlinked paths directly mutate canonical project files

2. `safety-restricted`
   - only allows symlinking paths ignored by git (`git check-ignore`)
   - symlink request for tracked paths fails with `ERR_SYMLINK_RESTRICTED`

## Security and Safety Notes

- `shared-live` intentionally bypasses isolation for symlinked paths.
- teams should use `safety-restricted` for generated/cache paths.
- hard excludes protect snapshot internals and workspace metadata from accidental coupling.
