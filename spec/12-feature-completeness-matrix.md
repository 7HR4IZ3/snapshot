# 12 - Feature Completeness Matrix

This matrix tracks implemented features and current support status.

## Core CLI and Workflow

- `init` with idempotent behavior: implemented
- optional project-path inference: implemented
- spawn/status/diff/list: implemented
- review (interactive + non-interactive): implemented
- merge and merge-many: implemented
- merge preflight/reporting: implemented
- revert command family: implemented
- cleanup and archive purge: implemented
- unlock command: implemented

## Backend Support

- `worktree`: implemented
- `apfs-cow`: implemented
- `overlay`: implemented with host capability constraints and fallback policy
- strict backend mode: implemented
- backend diagnostics command (`backends`): implemented

## Workspace Content Policies

- include globs: implemented
- exclude globs: implemented
- symlink globs (`apfs-cow`): implemented
- symlink modes (`shared-live`, `safety-restricted`): implemented
- per-spawn overrides for include/exclude/symlink: implemented
- hard internal excludes always-on: implemented

## Merge and Conflict Handling

- workspace auto-checkpoint before merge: implemented
- conflict class artifacts: implemented
- merge-many stop/continue semantics: implemented
- skipped entry recording after stop-on-conflict: implemented
- merge auto-commit config default: implemented

## Recovery and Operations

- doctor command: implemented
- repair-mounts: implemented
- lock force-unlock: implemented
- revert abort: implemented

## Packaging and Distribution

- JS build output to `dist`: implemented
- executable `dist/cli.js`: implemented
- package bin mapping (`snapshot`): implemented
- global link workflow: implemented

## Testing Coverage

- integration tests for spawn/merge/revert/cleanup: implemented
- backend and policy tests: implemented
- command behavior for path inference: implemented

## Known Constraints

- overlay backend availability depends on host/platform capabilities.
- `shared-live` symlink mode intentionally allows direct mutation of canonical project content.
